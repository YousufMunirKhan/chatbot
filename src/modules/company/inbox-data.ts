import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ticketNumberFromState } from '@/lib/tickets/ticket-number';
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
  startedAt: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
  aiEnabled: boolean;
  assignedAgentId: string | null;
  firstAgentReplyAt: string | null;
  csatRating: number | null;
  priority: string;
  tags: string[];
  state: Record<string, unknown>;
}

export interface InboxMessage {
  id: string;
  senderType: string;
  content: string;
  createdAt: string;
}

export interface InternalNote {
  id: string;
  note: string;
  author: string;
  createdAt: string;
}

export interface CannedResponse {
  id: string;
  title: string;
  body: string;
}

export interface ConversationDetail {
  id: string;
  status: string;
  channel: string;
  language: string | null;
  visitorId: string | null;
  startedAt: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
  aiEnabled: boolean;
  assignedAgentId: string | null;
  priority: string;
  tags: string[];
  state: Record<string, unknown>;
  csatRating: number | null;
  csatComment: string | null;
  messages: InboxMessage[];
  notes: InternalNote[];
  cannedResponses: CannedResponse[];
}

export async function listCannedResponses(): Promise<CannedResponse[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('canned_responses')
    .select('id,title,body')
    .eq('company_id', companyId)
    .order('title', { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return { id: x.id as string, title: x.title as string, body: x.body as string };
  });
}

export async function listConversations(): Promise<ConversationRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('conversations')
    .select('id,status,channel,language,visitor_id,unread_count,started_at,last_message_at,closed_at,ai_enabled,assigned_agent_id,first_agent_reply_at,csat_rating,priority,tags,state_json')
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
      startedAt: (c.started_at as string) ?? null,
      lastMessageAt: (c.last_message_at as string) ?? null,
      closedAt: (c.closed_at as string) ?? null,
      aiEnabled: Boolean(c.ai_enabled),
      assignedAgentId: (c.assigned_agent_id as string) ?? null,
      firstAgentReplyAt: (c.first_agent_reply_at as string) ?? null,
      csatRating: (c.csat_rating as number) ?? null,
      priority: (c.priority as string) ?? 'normal',
      tags: (c.tags as string[]) ?? [],
      state: c.state_json && typeof c.state_json === 'object' ? (c.state_json as Record<string, unknown>) : {},
    };
  });
}

/** Average CSAT (1–5) and response count across the loaded conversations. */
export function summarizeCsat(conversations: ConversationRow[]) {
  const rated = conversations.filter((c) => typeof c.csatRating === 'number' && c.csatRating! > 0);
  const responses = rated.length;
  const average = responses ? rated.reduce((sum, c) => sum + (c.csatRating ?? 0), 0) / responses : null;
  return { responses, average };
}

export async function getInboxSlaSummary() {
  const conversations = await listConversations();
  return summarizeInboxSla(conversations);
}

/** A conversation is overdue when it has waited on a human past the SLA window. */
export function isConversationOverdue(c: ConversationRow, slaMinutes: number): boolean {
  if (c.status !== 'needs_human' || !c.lastMessageAt) return false;
  return Date.now() - new Date(c.lastMessageAt).getTime() > slaMinutes * 60 * 1000;
}

export function conversationSource(c: Pick<ConversationRow, 'channel' | 'visitorId' | 'tags' | 'state'>): 'customer' | 'helpdesk' | 'connector' | 'manual' {
  const source = typeof c.state.source === 'string' ? c.state.source : '';
  if (source.includes('connector')) return 'connector';
  if (source.includes('manual')) return 'manual';
  if (source.includes('helpdesk') || c.tags.includes('helpdesk') || c.visitorId?.startsWith('staff:')) return 'helpdesk';
  return 'customer';
}

export function slaLabel(c: ConversationRow, slaMinutes: number): string {
  if (c.status === 'closed' && c.startedAt && c.closedAt) {
    const minutes = Math.max(1, Math.round((new Date(c.closedAt).getTime() - new Date(c.startedAt).getTime()) / 60000));
    return `Resolved in ${minutes}m`;
  }
  if (c.status !== 'needs_human' || !c.lastMessageAt) return '-';
  const dueAt = new Date(c.lastMessageAt).getTime() + slaMinutes * 60000;
  const diff = dueAt - Date.now();
  if (diff <= 0) return `Overdue ${Math.max(1, Math.ceil(Math.abs(diff) / 60000))}m`;
  return `Due in ${Math.max(1, Math.ceil(diff / 60000))}m`;
}

export function conversationTicketNumber(c: Pick<ConversationRow | ConversationDetail, 'id' | 'state'>): string {
  return ticketNumberFromState(c.state, c.id);
}

export function summarizeInboxSla(conversations: ConversationRow[], slaMinutes = 5) {
  const needsHuman = conversations.filter((c) => c.status === 'needs_human');
  return {
    needsHuman: needsHuman.length,
    missed: needsHuman.filter((c) => isConversationOverdue(c, slaMinutes)).length,
    unassigned: needsHuman.filter((c) => !c.assignedAgentId).length,
    slaMinutes,
  };
}

export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  const user = await getSessionUser();
  if (!user?.companyId) return null;
  const companyId = user.companyId;
  const sb = createSupabaseServiceClient();

  const { data: convo, error } = await sb
    .from('conversations')
    .select('id,company_id,status,channel,language,visitor_id,started_at,last_message_at,closed_at,ai_enabled,assigned_agent_id,priority,tags,state_json,csat_rating,csat_comment')
    .eq('company_id', companyId) // scope prevents cross-company access
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!convo) return null;

  const c = convo as Record<string, unknown>;
  if ((c.company_id as string) !== companyId) return null;

  const [{ data: messages, error: mErr }, { data: noteRows }, cannedResponses] = await Promise.all([
    sb
      .from('messages')
      .select('id,sender_type,content_text,created_at')
      .eq('company_id', companyId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    sb
      .from('conversation_internal_notes')
      .select('id,note,created_at,users(full_name,email)')
      .eq('company_id', companyId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    listCannedResponses(),
  ]);
  if (mErr) throw mErr;

  const notes: InternalNote[] = (noteRows ?? []).map((n) => {
    const x = n as Record<string, unknown>;
    const u = x.users as { full_name?: string; email?: string } | null;
    return {
      id: x.id as string,
      note: (x.note as string) ?? '',
      author: u?.full_name || u?.email || 'Agent',
      createdAt: x.created_at as string,
    };
  });

  return {
    id: c.id as string,
    status: c.status as string,
    channel: c.channel as string,
    language: (c.language as string) ?? null,
    visitorId: (c.visitor_id as string) ?? null,
    startedAt: (c.started_at as string) ?? null,
    lastMessageAt: (c.last_message_at as string) ?? null,
    closedAt: (c.closed_at as string) ?? null,
    aiEnabled: Boolean(c.ai_enabled),
    assignedAgentId: (c.assigned_agent_id as string) ?? null,
    priority: (c.priority as string) ?? 'normal',
    tags: (c.tags as string[]) ?? [],
    state: c.state_json && typeof c.state_json === 'object' ? (c.state_json as Record<string, unknown>) : {},
    csatRating: (c.csat_rating as number) ?? null,
    csatComment: (c.csat_comment as string) ?? null,
    messages: (messages ?? []).map((m) => {
      const x = m as Record<string, unknown>;
      return {
        id: x.id as string,
        senderType: x.sender_type as string,
        content: (x.content_text as string) ?? '',
        createdAt: x.created_at as string,
      };
    }),
    notes,
    cannedResponses,
  };
}
