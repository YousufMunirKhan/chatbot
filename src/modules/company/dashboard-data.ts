import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId, getCurrentCompany, listBots } from './data';

/**
 * Home dashboard data layer.
 *
 * Every number here answers "what changed, and is there anything for me to do?".
 * Lifetime cumulative counts were removed on purpose: a total that only ever
 * grows cannot tell an owner whether to open the inbox today, and the two worst
 * offenders were actively misleading —
 *
 *  - the old `activeConversations` counted every chat that was not `closed`,
 *    including chats the assistant handled perfectly and chats nobody ever
 *    closed, and it was labelled "Reply to active conversations";
 *  - the old `customerWork` summed leads + appointments + orders since the
 *    beginning of time and was labelled "Review customer requests".
 *
 * They are replaced by `needsReply` (a real queue) and trailing-7-day metrics
 * that each carry the previous 7 days so the page can show a comparison.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface MetricTrend {
  /** The trailing 7 days. */
  current: number;
  /** The 7 days before that, for a week-over-week comparison. */
  previous: number;
  /** `current - previous`. Positive is more this week. */
  change: number;
}

export interface UnansweredQuestion {
  id: string;
  question: string;
  timesAsked: number;
}

/**
 * The four things that can be sitting in a queue with the owner's name on it.
 *
 * Ordered by how badly it goes if it is ignored: a reply that has already blown
 * its target is worse than one still inside it, a person waiting in chat is
 * worse than an enquiry that can wait until this afternoon, and a message that
 * silently failed to send is the one nobody would ever notice on their own.
 */
export type AttentionKey =
  | 'overdue_replies'
  | 'needs_reply'
  | 'uncontacted_enquiries'
  | 'failed_automations';

export interface AttentionItem {
  key: AttentionKey;
  /** Always greater than zero — a queue of nothing is not an item. */
  count: number;
  /** Where the owner goes to clear it. */
  href: string;
}

/**
 * Customer satisfaction for the trailing 7 days.
 *
 * `enabled` is read from the widget's own appearance settings rather than
 * inferred from the absence of ratings, because "nobody rated you this week"
 * and "you never switched the rating on" need different sentences. Only the
 * second one is the owner's to fix.
 */
export interface CsatSummary {
  /** Mean of 1–5 ratings left in the window, or null when nobody rated. */
  average: number | null;
  responses: number;
  /** Whether the star rating is switched on for any assistant. */
  enabled: boolean;
}

export interface CompanyDashboardSummary {
  company: Awaited<ReturnType<typeof getCurrentCompany>>;
  /**
   * Chats that are sitting with a human and are not closed. This is the only
   * number on the page that is a to-do list, so it is the only one allowed to
   * carry an action verb.
   */
  needsReply: number;
  /** Chats not yet closed. Descriptive only — never labelled with a verb. */
  openChats: number;
  /** Chats started in the trailing 7 days. */
  conversations7d: MetricTrend;
  /** Chats in the window the assistant closed out without a human replying. */
  answeredByAi7d: MetricTrend;
  /** Leads, appointment requests and chat orders created in the window. */
  newCustomerWork7d: MetricTrend;
  /** Real customer questions from the window that had no matching knowledge. */
  unansweredQuestions: UnansweredQuestion[];
  /**
   * Every queue with something in it, worst first. Empty means the owner is
   * genuinely clear — which the page says in words rather than as four zeros.
   */
  attention: AttentionItem[];
  /** How customers rated their chats in the window. */
  csat7d: CsatSummary;
}

function trend(current: number, previous: number): MetricTrend {
  return { current, previous, change: current - previous };
}

/** Rows of `table` created inside `[from, to)`. */
async function countCreatedBetween(
  table: string,
  companyId: string,
  from: string,
  to?: string,
): Promise<number> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', from);
  if (to) query = query.lt('created_at', to);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Conversations started inside `[from, to)`. */
async function countChatsStarted(companyId: string, from: string, to?: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', from);
  if (to) query = query.lt('started_at', to);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Conversations started inside `[from, to)` that never reached a human: no agent
 * reply was ever sent and the chat is not currently queued for one.
 */
async function countChatsAnsweredByAi(companyId: string, from: string, to?: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', from)
    .is('first_agent_reply_at', null)
    .not('status', 'in', '(needs_human,human_active)');
  if (to) query = query.lt('started_at', to);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Leads + appointment requests + chat orders created inside `[from, to)`. */
async function countCustomerWork(companyId: string, from: string, to?: string): Promise<number> {
  const [leads, appointments, orders] = await Promise.all([
    countCreatedBetween('leads', companyId, from, to),
    countCreatedBetween('appointments', companyId, from, to),
    countCreatedBetween('chat_orders', companyId, from, to),
  ]);
  return leads + appointments + orders;
}

async function countNeedsReply(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('status', ['needs_human', 'human_active'])
    .neq('status', 'closed');
  if (error) throw error;
  return count ?? 0;
}

async function countOpenChats(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('status', 'in', '(closed,expired)');
  if (error) throw error;
  return count ?? 0;
}

/**
 * Enquiries nobody has picked up yet.
 *
 * `new` is the only lead status that means "no human has touched this"; every
 * other stage in `LEAD_STATUS_LABELS` implies somebody already made contact or
 * decided not to. Deliberately not windowed to 7 days — an enquiry from three
 * weeks ago that was never answered is more urgent, not less.
 */
async function countUncontactedEnquiries(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'new');
  if (error) throw error;
  return count ?? 0;
}

/**
 * Chats that blew their first-response target and are *still* unanswered.
 *
 * A breach that was later answered is history and belongs in Reports; only the
 * ones nobody has replied to yet are a to-do. Companies with no reply-time
 * target have no `sla_states` rows at all, so this returns 0 and the tile never
 * renders — which is the point: an always-zero tile for a feature you have not
 * switched on is noise.
 */
async function countOverdueReplies(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('sla_states')
    .select('conversation_id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('first_response_breached', true)
    .is('first_response_at', null)
    .is('resolved_at', null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Automatic messages that did not go out in the last 7 days.
 *
 * The single most invisible failure in the product: the owner believes every
 * abandoned cart got a nudge, and nothing anywhere says otherwise.
 */
async function countFailedAutomations(companyId: string, from: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { count, error } = await sb
    .from('automation_runs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'failed')
    .gte('created_at', from);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Star ratings customers left in the window.
 *
 * Reads `conversations.csat_rating`, which is what the widget's rating endpoint
 * actually writes; `conversation_ratings` is the older table that the 30-day
 * report still reads, and mixing the two would let Home and Reports disagree
 * about the same week.
 */
async function readCsat(companyId: string, from: string): Promise<{ average: number | null; responses: number }> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('conversations')
    .select('csat_rating')
    .eq('company_id', companyId)
    .not('csat_rating', 'is', null)
    .gte('csat_rated_at', from)
    .limit(2000);
  if (error) throw error;
  const ratings = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.csat_rating)
    .filter((value): value is number => typeof value === 'number');
  if (ratings.length === 0) return { average: null, responses: 0 };
  return {
    average: ratings.reduce((sum, n) => sum + n, 0) / ratings.length,
    responses: ratings.length,
  };
}

/**
 * Runs a count that depends on an optional feature's table.
 *
 * `sla_states` and `automation_runs` only exist once their migrations have run,
 * and `csat_rated_at` only exists on newer schemas. None of them is worth a 500
 * on the one page every owner opens first, so a failure degrades that single
 * signal to "nothing to report" and leaves the rest of the board standing.
 */
async function optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Questions customers asked in the window that the assistant had no knowledge
 * for, deduplicated and counted. Only the question text is exposed — quality
 * scores stay internal, the owner gets a to-do.
 */
async function listUnansweredQuestions(companyId: string, from: string): Promise<UnansweredQuestion[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('answer_quality_logs')
    .select('question')
    .eq('company_id', companyId)
    .in('failure_reason', ['missing_info', 'weak_retrieval'])
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const counts = new Map<string, UnansweredQuestion>();
  for (const row of data ?? []) {
    const question = ((row as Record<string, unknown>).question as string | null)?.trim() ?? '';
    if (question.length < 5) continue;
    const key = normalizeQuestion(question);
    const existing = counts.get(key);
    if (existing) existing.timesAsked += 1;
    else counts.set(key, { id: key.slice(0, 60), question, timesAsked: 1 });
  }

  return [...counts.values()].sort((a, b) => b.timesAsked - a.timesAsked).slice(0, 3);
}

export async function getCompanyDashboardSummary(): Promise<CompanyDashboardSummary> {
  const companyId = await getCompanyId();
  const now = Date.now();
  const currentFrom = new Date(now - WEEK_MS).toISOString();
  const previousFrom = new Date(now - 2 * WEEK_MS).toISOString();

  const [
    company,
    needsReply,
    openChats,
    chatsThisWeek,
    chatsLastWeek,
    aiThisWeek,
    aiLastWeek,
    workThisWeek,
    workLastWeek,
    unansweredQuestions,
    uncontactedEnquiries,
    overdueReplies,
    failedAutomations,
    csat,
    bots,
  ] = await Promise.all([
    getCurrentCompany(),
    countNeedsReply(companyId),
    countOpenChats(companyId),
    countChatsStarted(companyId, currentFrom),
    countChatsStarted(companyId, previousFrom, currentFrom),
    countChatsAnsweredByAi(companyId, currentFrom),
    countChatsAnsweredByAi(companyId, previousFrom, currentFrom),
    countCustomerWork(companyId, currentFrom),
    countCustomerWork(companyId, previousFrom, currentFrom),
    listUnansweredQuestions(companyId, currentFrom),
    optional(() => countUncontactedEnquiries(companyId), 0),
    optional(() => countOverdueReplies(companyId), 0),
    optional(() => countFailedAutomations(companyId, currentFrom), 0),
    optional(() => readCsat(companyId, currentFrom), { average: null, responses: 0 }),
    optional(() => listBots(), []),
  ]);

  // Built in urgency order, then filtered — so the page never has to decide
  // which of four zeroes to hide, and an empty array means "you are clear".
  const attention: AttentionItem[] = (
    [
      { key: 'overdue_replies', count: overdueReplies, href: '/company/inbox' },
      { key: 'needs_reply', count: needsReply, href: '/company/inbox' },
      { key: 'uncontacted_enquiries', count: uncontactedEnquiries, href: '/company/leads' },
      { key: 'failed_automations', count: failedAutomations, href: '/company/automations' },
    ] satisfies AttentionItem[]
  ).filter((item) => item.count > 0);

  return {
    company,
    needsReply,
    openChats,
    conversations7d: trend(chatsThisWeek, chatsLastWeek),
    answeredByAi7d: trend(aiThisWeek, aiLastWeek),
    newCustomerWork7d: trend(workThisWeek, workLastWeek),
    unansweredQuestions,
    attention,
    csat7d: {
      ...csat,
      enabled: bots.some((bot) => bot.appearance.csatEnabled === true),
    },
  };
}
