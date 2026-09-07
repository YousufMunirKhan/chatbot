'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { notify } from '@/lib/notify';
import { markFirstResponse, markResolved } from '@/lib/sla';
import { getCompanyId } from './data';
import { MAX_SNOOZE_DAYS, snoozePresetMinutes } from './components/inbox-snooze-presets';

export type ActionState = { error?: string; ok?: boolean };

const conversationIdSchema = z.object({ conversationId: z.string().uuid() });

const replySchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().min(1, 'Reply cannot be empty').max(4000, 'Reply is too long'),
});

/** Confirm the conversation belongs to this company; returns true if owned. */
async function ownsConversation(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  companyId: string,
  conversationId: string,
): Promise<boolean> {
  const { data } = await sb
    .from('conversations')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();
  return Boolean(data);
}

function revalidateInbox(conversationId: string) {
  revalidatePath('/company/inbox');
  revalidatePath(`/company/inbox/${conversationId}`);
}

async function updateConversationState(params: {
  conversationId: string;
  values: Record<string, unknown>;
}): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  if (!(await ownsConversation(sb, companyId, params.conversationId))) {
    return { error: 'Conversation not found' };
  }

  const { data, error } = await sb
    .from('conversations')
    .update(params.values)
    .eq('company_id', companyId)
    .eq('id', params.conversationId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'Conversation was not updated' };

  revalidateInbox(params.conversationId);
  return { ok: true };
}

export async function sendAgentReplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  if (!user) return { error: 'Not signed in' };

  const parsed = replySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { conversationId, text } = parsed.data;

  const sb = createSupabaseServiceClient();
  if (!(await ownsConversation(sb, companyId, conversationId))) {
    return { error: 'Conversation not found' };
  }

  const { data: before } = await sb
    .from('conversations')
    .select('status, assigned_agent_id')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();
  const wasHumanActive = (before as { status?: string } | null)?.status === 'human_active';

  if (!wasHumanActive) {
    await sb.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'system',
      sender_id: user.userId,
      content_text: 'A human agent joined the chat.',
      content_type: 'system',
    });
  }

  const { error: insErr } = await sb.from('messages').insert({
    company_id: companyId,
    conversation_id: conversationId,
    sender_type: 'agent',
    sender_id: user.userId,
    content_text: text,
  });
  if (insErr) return { error: insErr.message };

  // Manual reply takes over: pause AI, mark human-active, assign this agent.
  const { error: updErr } = await sb
    .from('conversations')
    .update({
      ai_enabled: false,
      status: 'human_active',
      assigned_agent_id: user.userId,
      first_agent_reply_at: wasHumanActive ? undefined : new Date().toISOString(),
      unread_count: 0,
      last_message_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', conversationId);
  if (updErr) return { error: updErr.message };

  // Stop the SLA first-response clock. Harmless when no policy is running.
  await markFirstResponse({ companyId, conversationId });

  revalidateInbox(conversationId);
  return { ok: true };
}

export async function pauseAiAction(formData: FormData): Promise<ActionState> {
  const { conversationId } = conversationIdSchema.parse(Object.fromEntries(formData));
  return updateConversationState({
    conversationId,
    values: { ai_enabled: false, status: 'human_active' },
  });
}

export async function resumeAiAction(formData: FormData): Promise<ActionState> {
  const { conversationId } = conversationIdSchema.parse(Object.fromEntries(formData));
  return updateConversationState({
    conversationId,
    values: { ai_enabled: true, status: 'ai_active', closed_at: null },
  });
}

export async function closeChatAction(formData: FormData): Promise<ActionState> {
  const { conversationId } = conversationIdSchema.parse(Object.fromEntries(formData));
  const result = await updateConversationState({
    conversationId,
    values: { ai_enabled: false, status: 'closed', closed_at: new Date().toISOString() },
  });
  if (result.ok) await markResolved({ companyId: await getCompanyId(), conversationId });
  return result;
}

const resolveTicketSchema = z.object({
  conversationId: z.string().uuid(),
  resolution: z.string().min(3, 'Resolution message is required').max(2000),
});

function emailFromConversation(row: Record<string, unknown> | null): string | null {
  const state = row?.state_json && typeof row.state_json === 'object'
    ? (row.state_json as Record<string, unknown>)
    : {};
  const reportedBy = typeof state.reportedBy === 'string' ? state.reportedBy : null;
  const visitorId = typeof row?.visitor_id === 'string' ? row.visitor_id : null;
  const candidate = reportedBy || visitorId;
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function resolveTicketAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = resolveTicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid resolution' };

  const sb = createSupabaseServiceClient();
  const { data: convo } = await sb
    .from('conversations')
    .select('id,visitor_id,state_json,priority,tags')
    .eq('company_id', companyId)
    .eq('id', parsed.data.conversationId)
    .maybeSingle();
  if (!convo) return { error: 'Conversation not found' };

  const now = new Date().toISOString();
  const { error } = await sb
    .from('conversations')
    .update({
      ai_enabled: false,
      status: 'closed',
      closed_at: now,
      last_message_at: now,
      unread_count: 0,
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.conversationId);
  if (error) return { error: error.message };

  await sb.from('messages').insert({
    company_id: companyId,
    conversation_id: parsed.data.conversationId,
    sender_type: 'system',
    sender_id: user.userId,
    content_text: `Ticket resolved: ${parsed.data.resolution}`,
    content_type: 'system',
    metadata_json: { source: 'ticket_resolved' },
  });

  const email = emailFromConversation(convo as Record<string, unknown>);
  if (email) {
    await sendEmail({
      to: email,
      subject: 'Your support ticket is resolved',
      html: `<h2>Your support ticket is resolved</h2><p>${escapeHtml(parsed.data.resolution)}</p>`,
    }).catch(() => undefined);
  }

  await notify({
    companyId,
    type: 'helpdesk_issue_resolved',
    title: 'Ticket resolved',
    body: parsed.data.resolution,
    data: {
      conversationId: parsed.data.conversationId,
      resolvedBy: user.email,
      resolvedByUserId: user.userId,
      priority: (convo as Record<string, unknown>).priority ?? null,
      tags: (convo as Record<string, unknown>).tags ?? [],
      reporterEmail: email,
    },
    email: false,
  });

  revalidateInbox(parsed.data.conversationId);
  revalidatePath('/company/notifications');
  revalidatePath('/company/webhooks');
  return { ok: true };
}

// ---- Assignment ----------------------------------------------------------

/**
 * `unassigned` rather than an empty string: an empty `<option>` value and a
 * missing field are the same thing in a FormData, so "put this back in the
 * unassigned pile" would be indistinguishable from a form that failed to
 * serialise.
 */
const UNASSIGNED = 'unassigned';

const assignSchema = z.object({
  conversationId: z.string().uuid(),
  assigneeId: z.union([z.string().uuid(), z.literal(UNASSIGNED)]),
});

/**
 * Hand a conversation to a colleague, or put it back in the unassigned pile.
 *
 * Until now the only assignment was the implicit one in `sendAgentReplyAction`:
 * whoever replied got the conversation, and nobody could pass it on. This is
 * the explicit version, and it records who did it — `assigned_by` and
 * `assigned_at` on the row so the panel can say so without a join, and an audit
 * row so the trail survives the next reassignment.
 *
 * The assignee is checked against `company_users` for THIS company before the
 * update. The service-role client bypasses row-level security, so without that
 * check a crafted form could park another tenant's conversation on a stranger.
 */
export async function assignConversationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  if (!user) return { error: 'Not signed in' };

  const parsed = assignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Pick who this should go to' };
  const { conversationId, assigneeId } = parsed.data;

  const sb = createSupabaseServiceClient();
  if (!(await ownsConversation(sb, companyId, conversationId))) {
    return { error: 'Conversation not found' };
  }

  const assignee = assigneeId === UNASSIGNED ? null : assigneeId;
  if (assignee) {
    const { data: membership } = await sb
      .from('company_users')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('user_id', assignee)
      .maybeSingle();
    if (!membership) return { error: 'That person is not on your team' };
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from('conversations')
    .update({
      assigned_agent_id: assignee,
      assigned_at: assignee ? now : null,
      assigned_by: assignee ? user.userId : null,
    })
    .eq('company_id', companyId)
    .eq('id', conversationId);
  if (error) return { error: error.message };

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: user.userId,
    action: assignee ? 'conversation.assigned' : 'conversation.unassigned',
    target_type: 'conversation',
    target_id: conversationId,
    metadata_json: { assigneeUserId: assignee, self: assignee === user.userId },
  });

  revalidateInbox(conversationId);
  return { ok: true };
}

// ---- Snooze --------------------------------------------------------------

const snoozeSchema = z.object({
  conversationId: z.string().uuid(),
  /** One of SNOOZE_PRESETS, or empty when the agent picked an exact time. */
  preset: z.string().max(8).optional(),
  /** A `datetime-local` value: `2026-09-09T14:30`, in the agent's own clock. */
  until: z.string().max(32).optional(),
  /** `Date.prototype.getTimezoneOffset()` from that same clock. */
  tzOffsetMinutes: z.string().max(6).optional(),
});

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Turn what the form said into an instant, or into the reason it could not be.
 *
 * A preset is a duration, so it needs no timezone. A picked time is a wall
 * clock reading with no zone attached, which is why the control sends the
 * browser's offset alongside it: `getTimezoneOffset()` is UTC minus local in
 * minutes, so adding it to the value read as UTC gives the instant the agent
 * actually meant. Without that, an agent in Dubai asking for 2pm would be
 * snoozing until 6pm.
 */
function resolveSnoozeUntil(input: {
  preset?: string;
  until?: string;
  tzOffsetMinutes?: string;
}): { at: Date } | { error: string } {
  const minutes = snoozePresetMinutes(input.preset);
  if (minutes) return { at: new Date(Date.now() + minutes * 60_000) };

  const picked = (input.until ?? '').trim();
  if (!picked) return { error: 'Choose how long to put this aside for' };
  if (!LOCAL_DATETIME.test(picked)) return { error: 'That is not a time we can read' };

  const offset = Number(input.tzOffsetMinutes ?? '0');
  if (!Number.isFinite(offset) || Math.abs(offset) > 24 * 60) {
    return { error: 'That is not a time we can read' };
  }
  const at = new Date(Date.parse(`${picked}:00.000Z`) + offset * 60_000);
  if (Number.isNaN(at.getTime())) return { error: 'That is not a time we can read' };
  if (at.getTime() <= Date.now()) return { error: 'Pick a time in the future' };
  if (at.getTime() > Date.now() + MAX_SNOOZE_DAYS * 24 * 60 * 60_000) {
    return { error: `Pick a time within the next ${MAX_SNOOZE_DAYS} days` };
  }
  return { at };
}

/**
 * Put a conversation aside until a chosen time.
 *
 * Nothing about the conversation changes except `snoozed_until`: the status,
 * the assignment and the assistant setting are all left exactly as they were,
 * so waking up is nothing more than the timestamp falling into the past. The
 * queues test that timestamp against `now()` themselves, which is why a
 * conversation comes back on time even if the sweep in /api/cron/snooze has
 * stopped running.
 */
export async function snoozeConversationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  if (!user) return { error: 'Not signed in' };

  const parsed = snoozeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const resolved = resolveSnoozeUntil(parsed.data);
  if ('error' in resolved) return { error: resolved.error };

  const sb = createSupabaseServiceClient();
  if (!(await ownsConversation(sb, companyId, parsed.data.conversationId))) {
    return { error: 'Conversation not found' };
  }

  const until = resolved.at.toISOString();
  const { error } = await sb
    .from('conversations')
    .update({ snoozed_until: until, snoozed_by: user.userId })
    .eq('company_id', companyId)
    .eq('id', parsed.data.conversationId);
  if (error) return { error: error.message };

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: user.userId,
    action: 'conversation.snoozed',
    target_type: 'conversation',
    target_id: parsed.data.conversationId,
    metadata_json: { until },
  });

  revalidateInbox(parsed.data.conversationId);
  return { ok: true };
}

/** Bring a snoozed conversation back now, before it is due. */
export async function wakeConversationAction(formData: FormData): Promise<ActionState> {
  const { conversationId } = conversationIdSchema.parse(Object.fromEntries(formData));
  const result = await updateConversationState({
    conversationId,
    values: { snoozed_until: null, snoozed_by: null },
  });
  if (!result.ok) return result;

  const user = await getSessionUser();
  const sb = createSupabaseServiceClient();
  await sb.from('audit_logs').insert({
    company_id: await getCompanyId(),
    actor_user_id: user?.userId ?? null,
    action: 'conversation.woken',
    target_type: 'conversation',
    target_id: conversationId,
    metadata_json: {},
  });
  return result;
}

// ---- Ticketing: priority, tags, internal notes, canned responses ----------

const prioritySchema = z.object({
  conversationId: z.string().uuid(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
});

export async function setPriorityAction(formData: FormData): Promise<ActionState> {
  const parsed = prioritySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid priority' };
  return updateConversationState({
    conversationId: parsed.data.conversationId,
    values: { priority: parsed.data.priority },
  });
}

const tagsSchema = z.object({
  conversationId: z.string().uuid(),
  tags: z.string().max(500).optional(),
});

export async function updateTagsAction(formData: FormData): Promise<ActionState> {
  const parsed = tagsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid tags' };
  const tags = (parsed.data.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  return updateConversationState({ conversationId: parsed.data.conversationId, values: { tags } });
}

const noteSchema = z.object({
  conversationId: z.string().uuid(),
  note: z.string().min(1, 'Note cannot be empty').max(4000, 'Note is too long'),
});

export async function addInternalNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  if (!user) return { error: 'Not signed in' };
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid note' };

  const sb = createSupabaseServiceClient();
  if (!(await ownsConversation(sb, companyId, parsed.data.conversationId))) {
    return { error: 'Conversation not found' };
  }
  const { error } = await sb.from('conversation_internal_notes').insert({
    company_id: companyId,
    conversation_id: parsed.data.conversationId,
    user_id: user.userId,
    note: parsed.data.note,
  });
  if (error) return { error: error.message };
  revalidateInbox(parsed.data.conversationId);
  return { ok: true };
}

const cannedCreateSchema = z.object({
  title: z.string().min(1, 'Title required').max(120),
  body: z.string().min(1, 'Body required').max(4000),
});

export async function createCannedResponseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  const parsed = cannedCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('canned_responses').insert({
    company_id: companyId,
    title: parsed.data.title,
    body: parsed.data.body,
    created_by: user?.userId ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/company/inbox/canned');
  return { ok: true };
}

export async function deleteCannedResponseAction(formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Invalid id' };
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('canned_responses')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id.data);
  if (error) return { error: error.message };
  revalidatePath('/company/inbox/canned');
  return { ok: true };
}

/**
 * Collision detection. Marks the current agent as viewing a conversation and
 * reports whether a *different* agent was active in the last 45s. Called on
 * conversation open and on a short interval by the client presence component.
 */
export async function pingConversationViewAction(
  conversationId: string,
): Promise<{ otherViewer: string | null }> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const user = await getSessionUser();
  if (!user) return { otherViewer: null };
  const sb = createSupabaseServiceClient();

  const { data: convo } = await sb
    .from('conversations')
    .select('viewing_user_id,viewing_at')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();

  let otherViewer: string | null = null;
  const c = convo as { viewing_user_id?: string; viewing_at?: string } | null;
  if (c?.viewing_user_id && c.viewing_user_id !== user.userId && c.viewing_at) {
    const fresh = Date.now() - new Date(c.viewing_at).getTime() < 45 * 1000;
    if (fresh) {
      const { data: other } = await sb
        .from('users')
        .select('full_name,email')
        .eq('id', c.viewing_user_id)
        .maybeSingle();
      const o = other as { full_name?: string; email?: string } | null;
      otherViewer = o?.full_name || o?.email || 'Another agent';
    }
  }

  await sb
    .from('conversations')
    .update({ viewing_user_id: user.userId, viewing_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', conversationId);

  return { otherViewer };
}
