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
  /** Set while the conversation is put aside; in the past means it is back. */
  snoozedUntil: string | null;
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
  /** When the current assignment was made, and by whom — never the assignee. */
  assignedAt: string | null;
  assignedByName: string | null;
  snoozedUntil: string | null;
  snoozedByName: string | null;
  priority: string;
  tags: string[];
  state: Record<string, unknown>;
  csatRating: number | null;
  csatComment: string | null;
  leadName: string | null;
  leadContact: string | null;
  /** The company's members, for the assign control. */
  assignableMembers: InboxMemberOption[];
  messages: InboxMessage[];
  /** True when older messages exist above the loaded window. */
  hasEarlierMessages: boolean;
  /** Total messages in the thread, so the UI can say what it is hiding. */
  totalMessages: number;
  notes: InternalNote[];
  cannedResponses: CannedResponse[];
}

const CONVERSATION_COLUMNS =
  'id,status,channel,language,visitor_id,unread_count,started_at,last_message_at,closed_at,ai_enabled,assigned_agent_id,first_agent_reply_at,csat_rating,priority,tags,state_json,snoozed_until';

export const INBOX_PAGE_SIZE = 25;
export const DEFAULT_MESSAGE_WINDOW = 50;

/**
 * `everything` rather than `all` on purpose: the queue travels in the URL as the
 * shared `status` param, and the shared Pagination control drops `status=all` as
 * a no-op — which would silently bounce the agent back to the default queue.
 */
export type InboxQueue = 'waiting' | 'mine' | 'everything' | 'urgent' | 'poor' | 'closed' | 'snoozed';

export const INBOX_QUEUES: ReadonlyArray<{ key: InboxQueue; label: string }> = [
  { key: 'waiting', label: 'Waiting for you' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'everything', label: 'Everything' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'poor', label: 'Rated poorly' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'closed', label: 'Closed' },
];

/**
 * The queues a snoozed conversation drops out of. Not `everything` — that queue
 * means what it says, and an agent looking for a chat they put aside should
 * find it there rather than conclude it was deleted. Not `poor` or `closed`
 * either: those are records of what happened, not work waiting to be done.
 */
const OPEN_QUEUES: ReadonlySet<InboxQueue> = new Set<InboxQueue>(['waiting', 'mine', 'urgent']);

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

/**
 * The filters that narrow a queue, rather than replacing it.
 *
 * A queue answers "what kind of work is this" and a filter answers "whose, from
 * where, about what, and when" — so they compose: `waiting` with
 * `channel=whatsapp` is the WhatsApp share of the waiting queue, and every one
 * of the seven queues accepts all four. They travel in the URL so a filtered
 * queue is a link an agent can bookmark or paste to a colleague.
 */
export interface InboxFilters {
  channel?: string;
  /** A member's user id, or the two pseudo-values `unassigned` and `me`. */
  assignee?: string;
  tag?: string;
  /** Inclusive `yyyy-mm-dd` bounds on the last message, read in UTC. */
  from?: string;
  to?: string;
}

export const INBOX_ASSIGNEE_UNASSIGNED = 'unassigned';
export const INBOX_ASSIGNEE_ME = 'me';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The shape of a channel key, not the list of them. The list lives in the
 * column's own check constraint, which is the thing that decides what a channel
 * IS, and this value is only ever used as an equality test — so a channel that
 * does not exist returns an empty queue, which is the honest answer to a filter
 * for a channel nobody uses. What matters here is that nothing but a bare key
 * reaches the filter expression.
 */
const CHANNEL_KEY = /^[a-z][a-z_]{1,23}$/;

/**
 * Whatever arrived in the query string, reduced to something safe to hand to
 * PostgREST. Every value here ends up inside a filter expression, so anything
 * that is not a bare channel key, a uuid, a plain date or a short tag is
 * dropped rather than escaped — a filter nobody can express is better than one
 * that half-parses. The tag loses the characters PostgREST reads as array and
 * logical-tree punctuation for the same reason.
 */
export function parseInboxFilters(params?: {
  channel?: string;
  assignee?: string;
  tag?: string;
  from?: string;
  to?: string;
}): InboxFilters {
  const filters: InboxFilters = {};
  if (params?.channel && CHANNEL_KEY.test(params.channel)) filters.channel = params.channel;
  const assignee = params?.assignee?.trim();
  if (
    assignee &&
    (assignee === INBOX_ASSIGNEE_UNASSIGNED || assignee === INBOX_ASSIGNEE_ME || UUID.test(assignee))
  ) {
    filters.assignee = assignee;
  }
  const tag = params?.tag?.trim().toLowerCase().replace(/[,(){}"\\]/g, '');
  if (tag) filters.tag = tag.slice(0, 60);
  if (params?.from && DATE_ONLY.test(params.from)) filters.from = params.from;
  if (params?.to && DATE_ONLY.test(params.to)) filters.to = params.to;
  return filters;
}

export function hasInboxFilters(filters: InboxFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/**
 * One place that turns a queue, a search and a set of filters back into a URL,
 * so the rail, the filter bar and the pager cannot each remember a different
 * subset of the state and quietly drop the rest. The shared `Pagination`
 * control only knows about `q`, `status` and `page`, which is why the inbox
 * builds its own links.
 */
export function inboxHref(state: {
  queue?: InboxQueue;
  search?: string;
  filters?: InboxFilters;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (state.queue && state.queue !== 'waiting') params.set('status', state.queue);
  if (state.search) params.set('q', state.search);
  const filters = state.filters ?? {};
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (state.page && state.page > 1) params.set('page', String(state.page));
  const qs = params.toString();
  return qs ? `/company/inbox?${qs}` : '/company/inbox';
}

export interface InboxMemberOption {
  userId: string;
  name: string;
  role: string;
}

export interface InboxFilterOptions {
  members: InboxMemberOption[];
  /** Tags this company has actually used. Empty is a valid answer. */
  tags: string[];
}

/**
 * The member list for the assign control and the assignee filter, plus the tags
 * in use — one round trip, because the inbox page is held to a round-trip
 * budget (scripts/test-query-counts.mjs) and two lists that are always needed
 * together should not cost two.
 *
 * Without migration 0069 the function is missing, so this falls back to the
 * member query on its own: the assign control and the assignee filter still
 * work, and the tag box degrades from "suggests your tags" to "type a tag",
 * which is the failure mode worth having.
 */
export async function listInboxFilterOptions(): Promise<InboxFilterOptions> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data, error } = await sb.rpc('inbox_filter_options', {
    p_company_id: companyId, // tenant scope lives inside the function too
  });

  if (!error && data && typeof data === 'object') {
    const payload = data as { members?: unknown; tags?: unknown };
    const members = Array.isArray(payload.members) ? payload.members : [];
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    return {
      members: members.map((m) => {
        const x = m as Record<string, unknown>;
        return {
          userId: x.user_id as string,
          name: ((x.name as string) || 'Teammate').trim(),
          role: (x.role as string) ?? '',
        };
      }),
      tags: tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0),
    };
  }

  const { data: memberRows } = await sb
    .from('company_users')
    .select('user_id,role,users(full_name,email)')
    .eq('company_id', companyId) // scope prevents cross-company access
    .limit(200);

  const members = ((memberRows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const user = row.users as { full_name?: string; email?: string } | null;
    return {
      userId: row.user_id as string,
      name: (user?.full_name || user?.email || 'Teammate').trim(),
      role: (row.role as string) ?? '',
    };
  });
  return { members, tags: [] };
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
    snoozedUntil: (c.snoozed_until as string) ?? null,
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

/** The id no user has, so `mine` with nobody signed in matches nothing. */
const NO_USER = '00000000-0000-0000-0000-000000000000';

interface QueueScope {
  companyId: string;
  queue: InboxQueue;
  userId: string | null;
  ids?: string[];
  filters?: InboxFilters;
  /** One clock for the whole request, so the count and the rows agree. */
  now?: string;
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
        .eq('assigned_agent_id', scope.userId ?? NO_USER)
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
    case 'snoozed':
    case 'everything':
    default:
      break;
  }

  // Snooze is a property of the row, not a status, so it is applied after the
  // queue rather than inside it. A timestamp in the past is not a snooze: the
  // conversation is due and belongs back in its queue whether or not the sweep
  // in /api/cron/snooze has got to it yet.
  const now = scope.now ?? new Date().toISOString();
  if (scope.queue === 'snoozed') {
    query = query.gt('snoozed_until', now);
  } else if (OPEN_QUEUES.has(scope.queue)) {
    query = query.or(`snoozed_until.is.null,snoozed_until.lte.${now}`);
  }

  const filters = scope.filters;
  if (filters?.channel) query = query.eq('channel', filters.channel);
  if (filters?.assignee === INBOX_ASSIGNEE_UNASSIGNED) {
    query = query.is('assigned_agent_id', null);
  } else if (filters?.assignee) {
    query = query.eq(
      'assigned_agent_id',
      filters.assignee === INBOX_ASSIGNEE_ME ? scope.userId ?? NO_USER : filters.assignee,
    );
  }
  // Containment rather than equality: `tags` is an array and the filter asks
  // "carries this one", not "carries only this one".
  if (filters?.tag) query = query.contains('tags', [filters.tag]);
  // Both bounds are whole days in UTC. The `to` day is included, which is what
  // someone picking today as the end of a range means by it.
  if (filters?.from) query = query.gte('last_message_at', `${filters.from}T00:00:00.000Z`);
  if (filters?.to) query = query.lte('last_message_at', `${filters.to}T23:59:59.999Z`);

  return query;
}

const EMPTY_QUEUE_COUNTS: InboxQueueCounts = {
  waiting: 0,
  mine: 0,
  everything: 0,
  urgent: 0,
  poor: 0,
  closed: 0,
  snoozed: 0,
};

/**
 * The numbers on the queue rail.
 *
 * Was one `head: true, count: exact` request per queue — one round trip each,
 * ~1.4 s here, to produce a handful of integers over the same set of rows.
 * `inbox_queue_counts` (migrations 0062 and 0069) counts them all in one pass
 * with the filters copied from {@link queueQuery}, so the rail still cannot
 * disagree with the list.
 *
 * The per-queue counts remain as the fallback for an environment without 0062.
 * Deliberately company-wide: like the search box, the channel/assignee/tag/date
 * filters do not narrow these, so an agent working a filtered view can still
 * see how much work the filter is hiding from them.
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
        snoozed: Number(row.snoozed ?? 0),
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
  filters?: InboxFilters;
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

  // The filters narrow the same query the queue already built rather than
  // adding one of their own, so filtering costs no extra round trip at all.
  const scope: QueueScope = {
    companyId,
    queue,
    userId: user?.userId ?? null,
    ids,
    filters: options?.filters,
    now: new Date().toISOString(),
  };
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

/**
 * Put aside, and not yet due. The same test the queue query runs in SQL, so a
 * row cannot be listed in a queue and captioned "snoozed" at the same time.
 */
export function isSnoozed(
  c: Pick<ConversationRow, 'snoozedUntil'>,
  now: Date = new Date(),
): boolean {
  return Boolean(c.snoozedUntil && new Date(c.snoozedUntil).getTime() > now.getTime());
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
    .select('id,company_id,status,channel,language,visitor_id,started_at,last_message_at,closed_at,ai_enabled,assigned_agent_id,assigned_at,assigned_by,snoozed_until,snoozed_by,priority,tags,state_json,csat_rating,csat_comment')
    .eq('company_id', companyId) // scope prevents cross-company access
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!convo) return null;

  const c = convo as Record<string, unknown>;
  if ((c.company_id as string) !== companyId) return null;
  const assignedAgentId = (c.assigned_agent_id as string) ?? null;
  const assignedById = (c.assigned_by as string) ?? null;
  const snoozedById = (c.snoozed_by as string) ?? null;
  // The assignee, whoever assigned them and whoever snoozed it are three names
  // from one table, so they are one lookup rather than three. All three ids came
  // off a row that was already scoped to this company.
  const peopleIds = [...new Set([assignedAgentId, assignedById, snoozedById].filter(Boolean))] as string[];

  const [
    { data: messageRows, error: mErr },
    { count: messageCount },
    { data: noteRows },
    { data: leadRows },
    { data: peopleRows },
    filterOptions,
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
    peopleIds.length
      ? sb.from('users').select('id,full_name,email').in('id', peopleIds)
      : Promise.resolve({ data: [] as unknown[] }),
    listInboxFilterOptions(),
    listCannedResponses(),
  ]);
  if (mErr) throw mErr;

  const nameById = new Map<string, string>();
  for (const row of (peopleRows ?? []) as Array<Record<string, unknown>>) {
    nameById.set(row.id as string, ((row.full_name as string) || (row.email as string) || 'Agent') as string);
  }

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
    assignedAgentName: assignedAgentId ? nameById.get(assignedAgentId) ?? 'Agent' : null,
    assignedAt: (c.assigned_at as string) ?? null,
    assignedByName: assignedById ? nameById.get(assignedById) ?? 'Agent' : null,
    snoozedUntil: (c.snoozed_until as string) ?? null,
    snoozedByName: snoozedById ? nameById.get(snoozedById) ?? 'Agent' : null,
    priority: (c.priority as string) ?? 'normal',
    tags: (c.tags as string[]) ?? [],
    state: c.state_json && typeof c.state_json === 'object' ? (c.state_json as Record<string, unknown>) : {},
    csatRating: (c.csat_rating as number) ?? null,
    csatComment: (c.csat_comment as string) ?? null,
    leadName: ((lead?.name as string) ?? '').trim() || null,
    leadContact: (((lead?.email as string) ?? (lead?.phone as string)) ?? '').trim() || null,
    assignableMembers: filterOptions.members,
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
