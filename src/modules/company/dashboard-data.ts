import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId, getCurrentCompany } from './data';

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
  ]);

  return {
    company,
    needsReply,
    openChats,
    conversations7d: trend(chatsThisWeek, chatsLastWeek),
    answeredByAi7d: trend(aiThisWeek, aiLastWeek),
    newCustomerWork7d: trend(workThisWeek, workLastWeek),
    unansweredQuestions,
  };
}
