import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Inbox data layer (Module 11). Every query is bound to the SESSION user's own
 * `companyId` so company admins and agents can only ever read their own
 * company's conversations. Uses the service-role client (bypasses RLS) — tenant
 * scoping is enforced in code.
 */

export interface ConversationRow {
  id: string;
  status: string;
  channel: string;
  language: string | null;
  visitorId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  aiEnabled: boolean;
  assignedAgentId: string | null;
  firstAgentReplyAt: string | null;
}

export interface InboxMessage {
  id: string;
  senderType: string;
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  status: string;
  channel: string;
  language: string | null;
  visitorId: string | null;
  aiEnabled: boolean;
  assignedAgentId: string | null;
  messages: InboxMessage[];
}

export async function listConversations(): Promise<ConversationRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('conversations')
    .select('id,status,channel,language,visitor_id,unread_count,last_message_at,ai_enabled,assigned_agent_id,first_agent_reply_at')
    .eq('company_id', companyId)
    .order('last_message_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const c = row as Record<string, unknown>;
    return {
      id: c.id as string,
      status: c.status as string,
      channel: c.channel as string,
      language: (c.language as string) ?? null,
      visitorId: (c.visitor_id as string) ?? null,
      unreadCount: (c.unread_count as number) ?? 0,
      lastMessageAt: (c.last_message_at as string) ?? null,
      aiEnabled: Boolean(c.ai_enabled),
      assignedAgentId: (c.assigned_agent_id as string) ?? null,
      firstAgentReplyAt: (c.first_agent_reply_at as string) ?? null,
    };
  });
}

export async function getInboxSlaSummary() {
  const conversations = await listConversations();
  return summarizeInboxSla(conversations);
}

export function summarizeInboxSla(conversations: ConversationRow[]) {
  const needsHuman = conversations.filter((c) => c.status === 'needs_human');
  const now = Date.now();
  return {
    needsHuman: needsHuman.length,
    missed: needsHuman.filter((c) => c.lastMessageAt && now - new Date(c.lastMessageAt).getTime() > 5 * 60 * 1000).length,
    unassigned: needsHuman.filter((c) => !c.assignedAgentId).length,
  };
}

export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  const user = await getSessionUser();
  if (!user?.companyId) return null;
  const companyId = user.companyId;
  const sb = createSupabaseServiceClient();

  const { data: convo, error } = await sb
    .from('conversations')
    .select('id,company_id,status,channel,language,visitor_id,ai_enabled,assigned_agent_id')
    .eq('company_id', companyId) // scope prevents cross-company access
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!convo) return null;

  const c = convo as Record<string, unknown>;
  if ((c.company_id as string) !== companyId) return null;

  const { data: messages, error: mErr } = await sb
    .from('messages')
    .select('id,sender_type,content_text,created_at')
    .eq('company_id', companyId)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  if (mErr) throw mErr;

  return {
    id: c.id as string,
    status: c.status as string,
    channel: c.channel as string,
    language: (c.language as string) ?? null,
    visitorId: (c.visitor_id as string) ?? null,
    aiEnabled: Boolean(c.ai_enabled),
    assignedAgentId: (c.assigned_agent_id as string) ?? null,
    messages: (messages ?? []).map((m) => {
      const x = m as Record<string, unknown>;
      return {
        id: x.id as string,
        senderType: x.sender_type as string,
        content: (x.content_text as string) ?? '',
        createdAt: x.created_at as string,
      };
    }),
  };
}
