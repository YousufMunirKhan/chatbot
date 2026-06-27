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
