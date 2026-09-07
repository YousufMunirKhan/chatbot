import { getSessionUser } from '@/lib/auth';
import { humanizeStoredSubmission } from '@/lib/quick-actions-format';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ticketNumberFromState } from '@/lib/tickets/ticket-number';
import { getCompanyId } from './data';

/**
 * Inbox data layer (Module 11). Every query is bound to the SESSION user's own
 * `companyId` so company admins and agents can only ever read their own
 * company's conversations. Uses the service-role client (bypasses RLS) — tenant
 * scoping is enforced in code.
 *
 * The list is a queue, so the row carries what an agent needs to triage without
 * opening it: who it is from, what they last said, and whose queue it is in.
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
  /** First ~120 characters of the most recent message. */
  lastMessagePreview: string | null;
  /** 'visitor' | 'ai' | 'agent' | 'system' — who wrote the preview. */
  lastMessageSender: string | null;
  /** Resolved name of the agent this is assigned to. Never a bare "Assigned". */
  assignedAgentName: string | null;
  /** Captured lead name for this conversation, when one exists. */
  leadName: string | null;
  /** Captured email or phone, used when there is no name. */
  leadContact: string | null;
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
  assignedAgentName: string | null;
  priority: string;
  tags: string[];
  state: Record<string, unknown>;
  csatRating: number | null;
  csatComment: string | null;
  leadName: string | null;
  leadContact: string | null;
  messages: InboxMessage[];
  /** True when older messages exist above the loaded window. */
  hasEarlierMessages: boolean;
  /** Total messages in the thread, so the UI can say what it is hiding. */
  totalMessages: number;
  notes: InternalNote[];
  cannedResponses: CannedResponse[];
}

const CONVERSATION_COLUMNS =
  'id,status,channel,language,visitor_id,unread_count,started_at,last_message_at,closed_at,ai_enabled,assigned_agent_id,first_agent_reply_at,csat_rating,priority,tags,state_json';

export const INBOX_PAGE_SIZE = 25;
export const DEFAULT_MESSAGE_WINDOW = 50;

/**
 * `everything` rather than `all` on purpose: the queue travels in the URL as the
 * shared `status` param, and the shared Pagination control drops `status=all` as
 * a no-op — which would silently bounce the agent back to the default queue.
 */
export type InboxQueue = 'waiting' | 'mine' | 'everything' | 'urgent' | 'poor' | 'closed';

export const INBOX_QUEUES: ReadonlyArray<{ key: InboxQueue; label: string }> = [
  { key: 'waiting', label: 'Waiting for you' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'everything', label: 'Everything' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'poor', label: 'Rated poorly' },
  { key: 'closed', label: 'Closed' },
];

export type InboxQueueCounts = Record<InboxQueue, number>;

export interface ConversationPage {
  rows: ConversationRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export function normalizeQueue(value: string | undefined): InboxQueue {
  return INBOX_QUEUES.some((q) => q.key === value) ? (value as InboxQueue) : 'waiting';
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

function mapConversationRow(row: unknown): ConversationRow {
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
    lastMessagePreview: null,
    lastMessageSender: null,
    assignedAgentName: null,
    leadName: null,
    leadContact: null,
  };
}

/** Trims a raw message body down to something that fits two lines in a queue row. */
export function messagePreview(content: string, max = 120): string {
  // Submissions stored before the formatter existed still hold raw JSON. Render
  // them readably rather than showing an agent a payload.
  const flat = humanizeStoredSubmission(content)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * How many message rows the no-RPC fallback below is allowed to pull back.
 * Forty per conversation on a page of 25 — generous enough that a conversation
 * only loses its preview if it is buried under a thousand newer messages from
 * its page-mates, which is the case the RPC exists to remove entirely.
 */
const FALLBACK_MESSAGE_SCAN = 1000;

/**
 * The newest message of each conversation in the page — ONE round trip.
 *
 * This used to be one single-row lookup per conversation, and the comment
 * explaining why said a single `in(...)` query could not be trusted: one busy
 * thread would swallow the whole row budget and every other row would come back
 * blank. That objection was correct, so it is answered rather than ignored.
 * `inbox_last_messages` (migration 0062) is `distinct on (conversation_id)`, so
 * Postgres returns exactly one row per conversation and there is no shared
 * budget for a busy thread to consume. It walks the same
 * `idx_messages_conversation_created_desc` the 25 lookups were using — once.
 *
 * At ~230 ms per round trip on this deployment, that is 25 trips (≈5.7 s) down
 * to 1.
 *
 * If the function is missing (an environment that has not run 0062) the old
 * objection comes back, so the fallback is the bounded `in(...)` scan with a
 * budget of {@link FALLBACK_MESSAGE_SCAN} rows: still one round trip, and the
 * worst case is a missing preview on a row rather than a wrong one.
 */
async function lastMessageByConversation(
  companyId: string,
  ids: string[],
): Promise<Map<string, { preview: string; sender: string }>> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc('inbox_last_messages', {
    p_company_id: companyId, // tenant scope lives inside the function too
    p_conversation_ids: ids,
  });

  let rows = (data ?? []) as Array<Record<string, unknown>>;
  if (error) {
    const { data: scanned } = await sb
      .from('messages')
      .select('conversation_id,sender_type,content_text,created_at')
      .eq('company_id', companyId)
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(FALLBACK_MESSAGE_SCAN);
    rows = (scanned ?? []) as Array<Record<string, unknown>>;
  }

  // Newest-first either way, so the first row seen for a conversation wins.
  const previewById = new Map<string, { preview: string; sender: string }>();
  for (const row of rows) {
    const key = row.conversation_id as string;
    if (!key || previewById.has(key)) continue;
    previewById.set(key, {
      preview: messagePreview((row.content_text as string) ?? ''),
      sender: (row.sender_type as string) ?? 'visitor',
    });
  }
  return previewById;
}

/**
 * Fills in the three things the row needs but the conversations table does not
 * hold: the last message, the assigned agent's name, and any captured lead.
 * Three round trips for a page of any size (two when nothing is assigned).
 */
async function enrichConversations(companyId: string, rows: ConversationRow[]): Promise<ConversationRow[]> {
  if (rows.length === 0) return rows;
  const sb = createSupabaseServiceClient();
  const ids = rows.map((r) => r.id);
  const agentIds = [...new Set(rows.map((r) => r.assignedAgentId).filter((id): id is string => Boolean(id)))];

  const [previewById, leadsRes, agentsRes] = await Promise.all([
    lastMessageByConversation(companyId, ids),
    sb
      .from('leads')
      .select('conversation_id,name,email,phone,created_at')
      .eq('company_id', companyId)
      .in('conversation_id', ids)
      .order('created_at', { ascending: false }),
    agentIds.length
      ? sb.from('users').select('id,full_name,email').in('id', agentIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  // Rows arrive newest-first, so the first lead seen for a conversation wins.
  const leadById = new Map<string, { name: string | null; contact: string | null }>();
  for (const row of (leadsRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = row.conversation_id as string;
    if (!key || leadById.has(key)) continue;
    leadById.set(key, {
      name: ((row.name as string) ?? '').trim() || null,
      contact: ((row.email as string) ?? (row.phone as string) ?? '').trim() || null,
    });
  }

  const agentById = new Map<string, string>();
  for (const row of (agentsRes.data ?? []) as Array<Record<string, unknown>>) {
    agentById.set(row.id as string, ((row.full_name as string) || (row.email as string) || 'Agent') as string);
  }

  return rows.map((row) => {
    const message = previewById.get(row.id);
    const lead = leadById.get(row.id);
    return {
      ...row,
      lastMessagePreview: message?.preview ?? null,
      lastMessageSender: message?.sender ?? null,
      assignedAgentName: row.assignedAgentId ? agentById.get(row.assignedAgentId) ?? 'Agent' : null,
      leadName: lead?.name ?? null,
      leadContact: lead?.contact ?? null,
    };
  });
}

/**
 * Who the conversation is with, in order of usefulness: the captured lead name,
 * then their email or phone, then an anonymous visitor with a short, muted
 * suffix. A raw UUID slice is never the primary identifier.
 */
export function conversationDisplayName(
  c: Pick<ConversationRow, 'leadName' | 'leadContact' | 'visitorId'>,
): { label: string; suffix: string | null } {
  if (c.leadName) return { label: c.leadName, suffix: null };
  if (c.leadContact) return { label: c.leadContact, suffix: null };
  const raw = (c.visitorId ?? '').replace(/^staff:/, '');
  const suffix = raw ? raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toLowerCase() : '';
  return { label: 'Visitor', suffix: suffix || null };
}

/**
 * Unpaged read used by the SLA summary. Capped, and deliberately not enriched —
 * callers that render rows should use {@link listConversationsPaged}.
 */
export async function listConversations(): Promise<ConversationRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('company_id', companyId)
    .order('last_message_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map(mapConversationRow);
}

/** Conversation ids whose visitor, captured lead, or message text match `search`. */
async function searchConversationIds(companyId: string, search: string): Promise<string[]> {
  const sb = createSupabaseServiceClient();
  // `,` `(` `)` are PostgREST's logical-tree separators and would break the
  // `or(...)` filter below; `%` `*` `\` are wildcards a searcher never means
  // literally. Strip them rather than trying to escape inside a raw filter
  // string, so a search for "smith, jane" degrades to a plain substring match.
  const term = search.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!term) return [];
  const pattern = `%${term}%`;

  const [visitorRes, leadsRes, messagesRes] = await Promise.all([
    sb.from('conversations').select('id').eq('company_id', companyId).ilike('visitor_id', pattern).limit(200),
    sb
      .from('leads')
      .select('conversation_id')
      .eq('company_id', companyId)
      .not('conversation_id', 'is', null)
      .or(`name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(200),
    sb
      .from('messages')
      .select('conversation_id')
      .eq('company_id', companyId)
      .ilike('content_text', pattern)
      .order('created_at', { ascending: false })
      .limit(400),
  ]);

  const ids = new Set<string>();
  for (const row of (visitorRes.data ?? []) as Array<Record<string, unknown>>) ids.add(row.id as string);
  for (const row of (leadsRes.data ?? []) as Array<Record<string, unknown>>) ids.add(row.conversation_id as string);
  for (const row of (messagesRes.data ?? []) as Array<Record<string, unknown>>) ids.add(row.conversation_id as string);
  return [...ids].slice(0, 500);
}

interface QueueScope {
  companyId: string;
  queue: InboxQueue;
  userId: string | null;
  ids?: string[];
}

/**
 * One place where a queue turns into filters, shared by the list query and the
 * count query so the rail can never disagree with the list beneath it.
 */
function queueQuery(scope: QueueScope, options: { head: boolean }) {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('conversations')
    .select(CONVERSATION_COLUMNS, { count: 'exact', head: options.head })
    .eq('company_id', scope.companyId);

  if (scope.ids) query = query.in('id', scope.ids);

  switch (scope.queue) {
    case 'waiting':
      query = query.eq('status', 'needs_human');
      break;
    case 'mine':
      // No signed-in user id means no personal queue; match nothing rather than
      // quietly falling back to everyone's work.
      query = query
        .eq('assigned_agent_id', scope.userId ?? '00000000-0000-0000-0000-000000000000')
        .not('status', 'in', '(closed,expired)');
      break;
    case 'urgent':
      query = query.eq('priority', 'urgent').not('status', 'in', '(closed,expired)');
      break;
    case 'poor':
      query = query.lte('csat_rating', 2).not('csat_rating', 'is', null);
      break;
    case 'closed':
      query = query.eq('status', 'closed');
      break;
    case 'everything':
    default:
      break;
  }
  return query;
}

const EMPTY_QUEUE_COUNTS: InboxQueueCounts = {
  waiting: 0,
  mine: 0,
  everything: 0,
  urgent: 0,
  poor: 0,
  closed: 0,
};

/**
 * The six numbers on the queue rail.
 *
 * Was six `head: true, count: exact` requests — six round trips, ~1.4 s here,
 * to produce six integers over the same set of rows. `inbox_queue_counts`
 * (migration 0062) counts all six in one pass with the filters copied from
 * {@link queueQuery}, so the rail still cannot disagree with the list.
 *
 * The six counts remain as the fallback for an environment without 0062.
 */
export async function getInboxQueueCounts(): Promise<InboxQueueCounts> {
  const [companyId, user] = await Promise.all([getCompanyId(), getSessionUser()]);
  const scope = { companyId, userId: user?.userId ?? null };
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb.rpc('inbox_queue_counts', {
    p_company_id: companyId, // tenant scope lives inside the function too
    p_user_id: scope.userId,
    p_conversation_ids: null,
  });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (row) {
      return {
        waiting: Number(row.waiting ?? 0),
        mine: Number(row.mine ?? 0),
        everything: Number(row.everything ?? 0),
        urgent: Number(row.urgent ?? 0),
        poor: Number(row.poor ?? 0),
        closed: Number(row.closed ?? 0),
      };
    }
    return EMPTY_QUEUE_COUNTS;
  }

  const entries = await Promise.all(
    INBOX_QUEUES.map(async ({ key }) => {
      const { count, error: countError } = await queueQuery({ ...scope, queue: key }, { head: true });
      if (countError) throw countError;
      return [key, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as InboxQueueCounts;
}

export async function listConversationsPaged(options?: {
  page?: number;
  queue?: InboxQueue;
  search?: string;
  pageSize?: number;
}): Promise<ConversationPage> {
  const pageSize = options?.pageSize ?? INBOX_PAGE_SIZE;
  const queue = options?.queue ?? 'waiting';
  const search = options?.search?.trim();
  const [companyId, user] = await Promise.all([getCompanyId(), getSessionUser()]);

  let ids: string[] | undefined;
  if (search) {
    ids = await searchConversationIds(companyId, search);
    if (ids.length === 0) {
      return { rows: [], total: 0, page: 1, pageCount: 1, pageSize };
    }
  }

  const scope: QueueScope = { companyId, queue, userId: user?.userId ?? null, ids };
  const requestedPage = Math.max(1, options?.page ?? 1);
  const rowsFor = (index: number) =>
    queueQuery(scope, { head: false })
      .order('last_message_at', { ascending: false })
      .range((index - 1) * pageSize, index * pageSize - 1);

  // The count only decides whether the requested page EXISTS, so it does not
  // have to be waited for before asking for the rows. Fetching both together
  // turns two sequential round trips into one — and the retry below only runs
  // for the rare stale deep link that points past the end of the queue.
  const [countRes, optimisticRes] = await Promise.all([
    queueQuery(scope, { head: true }),
    rowsFor(requestedPage),
  ]);
  if (countRes.error) throw countRes.error;

  const total = countRes.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  let data = optimisticRes.data;
  if (page !== requestedPage) {
    const clamped = await rowsFor(page);
    if (clamped.error) throw clamped.error;
    data = clamped.data;
  } else if (optimisticRes.error) {
    throw optimisticRes.error;
  }

  const rows = await enrichConversations(companyId, (data ?? []).map(mapConversationRow));
  return { rows, total, page, pageCount, pageSize };
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

export async function getConversationDetail(
  id: string,
  options?: { messageLimit?: number },
): Promise<ConversationDetail | null> {
  const user = await getSessionUser();
  if (!user?.companyId) return null;
  const companyId = user.companyId;
  const sb = createSupabaseServiceClient();
  // Unbounded before: a 400-message thread rendered 400 DOM nodes into a scroll
  // box on every navigation. The newest `messageLimit` are loaded and the page
  // offers a "Load earlier" control for the rest.
  const messageLimit = Math.max(10, Math.min(options?.messageLimit ?? DEFAULT_MESSAGE_WINDOW, 1000));

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
  const assignedAgentId = (c.assigned_agent_id as string) ?? null;

  const [
    { data: messageRows, error: mErr },
    { count: messageCount },
    { data: noteRows },
    { data: leadRows },
    { data: agentRow },
    cannedResponses,
  ] = await Promise.all([
    sb
      .from('messages')
      .select('id,sender_type,content_text,created_at')
      .eq('company_id', companyId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(messageLimit),
    sb
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('conversation_id', id),
    sb
      .from('conversation_internal_notes')
      .select('id,note,created_at,users(full_name,email)')
      .eq('company_id', companyId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
    sb
      .from('leads')
      .select('name,email,phone')
      .eq('company_id', companyId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
    assignedAgentId
      ? sb.from('users').select('full_name,email').eq('id', assignedAgentId).maybeSingle()
      : Promise.resolve({ data: null }),
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

  const lead = (leadRows ?? [])[0] as Record<string, unknown> | undefined;
  const agent = agentRow as Record<string, unknown> | null;
  const totalMessages = messageCount ?? (messageRows ?? []).length;

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
    assignedAgentId,
    assignedAgentName: agent ? ((agent.full_name as string) || (agent.email as string) || 'Agent') : null,
    priority: (c.priority as string) ?? 'normal',
    tags: (c.tags as string[]) ?? [],
    state: c.state_json && typeof c.state_json === 'object' ? (c.state_json as Record<string, unknown>) : {},
    csatRating: (c.csat_rating as number) ?? null,
    csatComment: (c.csat_comment as string) ?? null,
    leadName: ((lead?.name as string) ?? '').trim() || null,
    leadContact: (((lead?.email as string) ?? (lead?.phone as string)) ?? '').trim() || null,
    // Fetched newest-first so the limit keeps the RECENT end of the thread;
    // reversed here so the transcript still reads oldest → newest.
    messages: (messageRows ?? [])
      .map((m) => {
        const x = m as Record<string, unknown>;
        return {
          id: x.id as string,
          senderType: x.sender_type as string,
          // Same rescue as the list preview: a submission stored as raw JSON
          // is rendered as labelled lines in the transcript too.
          content: humanizeStoredSubmission((x.content_text as string) ?? ''),
          createdAt: x.created_at as string,
        };
      })
      .reverse(),
    hasEarlierMessages: totalMessages > (messageRows ?? []).length,
    totalMessages,
    notes,
    cannedResponses,
  };
}
