'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

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
  return updateConversationState({
    conversationId,
    values: { ai_enabled: false, status: 'closed', closed_at: new Date().toISOString() },
  });
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
