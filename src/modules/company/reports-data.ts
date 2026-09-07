import { getCompanyCoreRow } from '@/lib/company/company-core';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { CHANNEL_LABELS, labelFor, humanizeToken } from '@/lib/constants';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getPlatformEmailSettings } from '@/lib/platform-settings';
import { zoneOffsetMinutes } from '@/lib/sla/schedule';
import { getCompanyId } from './data';
import {
  average,
  buildFunnel,
  buildHourHeatmap,
  containmentRate,
  firstContactResolution,
  groupQuestions,
  median,
  percentage,
  splitVisitors,
  topTopics,
  type FcrResult,
  type FunnelStage,
  type HourHeatmap,
  type TopicCount,
  type VisitorSplit,
} from './reports-metrics';

export interface ChannelReportRow {
  channel: string;
  label: string;
  conversations: number;
  messages: number;
  aiHandled: number;
  escalated: number;
  leads: number;
  /** Share of this channel's conversations that never needed a human. */
  automationRate: number;
}

export interface ReportTotals {
  conversations: number;
  messages: number;
  leads: number;
  escalated: number;
  automationRate: number;
  csatAverage: number | null;
  csatResponses: number;
}

export interface ReportsSnapshot {
  range: ReportRange;
  totals: ReportTotals;
  channels: ChannelReportRow[];
  daily: Array<{ date: string; conversations: number; messages: number }>;
  flows: Array<{ flowId: string; name: string; starts: number; completions: number; completionRate: number }>;
  heatmap: HourHeatmap;
  fcr: FcrResult;
}

/** A conversation that reached a human at any point. */
const ESCALATED_STATUSES = new Set(['needs_human', 'human_active']);

/** Conversations that are still someone's problem right now. */
const OPEN_STATUSES = ['ai_active', 'needs_human', 'human_active'];

/**
 * Read caps. Every list query on this page is bounded, because a report must
 * degrade into "the busiest N rows" rather than into a timeout: a chatty tenant
 * on a 90-day range would otherwise stream hundreds of thousands of rows into a
 * server component that renders a dozen numbers.
 */
const LIMITS = {
  conversations: 10000,
  messages: 20000,
  leads: 10000,
  ratings: 10000,
  flowEvents: 20000,
  slaEvents: 10000,
  orders: 5000,
  carts: 5000,
  appointments: 5000,
  qualityLogs: 2000,
  /** Text-bearing rows are capped harder — these carry message bodies. */
  visitorText: 5000,
  broadcasts: 500,
  automationRuns: 10000,
  rules: 200,
  members: 500,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ===========================================================================
// Date ranges
//
// Reports used to offer 7, 30 and 90 days and nothing else, which meant the
// commonest question a business asks — "how did last month go" — could not be
// asked at all. A window is now a first-class value: every reader takes a
// resolved `ReportRange` instead of a day count, and every query is bounded at
// BOTH ends. Adding the upper bound is what makes "last month" mean last month
// rather than "everything since the start of last month".
//
// WHY A RANGE CARRIES ITS OWN DAY KEYS
// The volume chart needs one bucket per day with no gaps. Building those keys
// from the range rather than from `Date.now()` is what keeps the chart aligned
// with the numbers above it, and it is the reason a custom range costs exactly
// the same number of round trips as a fixed one: the days are enumerated in
// memory, never queried for. A range must never turn one query into one query
// per day.
//
// WHY A COMPANY OFFSET
// "This month" is a wall-clock question. A shop in Auckland asking on the 1st
// wants its own month, not UTC's, and a UTC-only answer is wrong by a day for
// roughly half the planet twice a month. The offset comes from
// `companies.timezone`; a company that never set one gets 0 and therefore
// exactly the behaviour this file had before.
// ===========================================================================

/**
 * The longest window that may be asked for.
 *
 * This is a denial-of-service guard, not a preference. Every read below is
 * capped by row count, but the rows still have to be found, and "since the
 * beginning of time" on a table that grows forever is a table scan a customer
 * can trigger by typing a date into a URL. A year and a day covers every
 * calendar preset here, including year-to-date on the 31st of December.
 */
export const MAX_RANGE_DAYS = 366;

export type RangeKey =
  | 'last_7'
  | 'last_30'
  | 'last_90'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'year_to_date'
  | 'custom';

export interface ReportRange {
  key: RangeKey;
  /** Human label, used in the UI, the CSV filename and the email subject. */
  label: string;
  /** Inclusive lower bound, ISO. */
  since: string;
  /** EXCLUSIVE upper bound, ISO. Every query filters `< until`. */
  until: string;
  /** Calendar days the window covers. */
  days: number;
  /** Minutes the company is ahead of UTC — decides where a day starts. */
  offsetMinutes: number;
  /** Every day in the window as `YYYY-MM-DD`, oldest first. */
  dayKeys: string[];
  /**
   * Set when the request could not be honoured as asked and was corrected —
   * an unparseable date, an end before a start, or a span over the cap. The
   * page renders it, so a silently different answer is never given.
   */
  notice?: string;
}

/** The ranges offered in the UI, in the order they are shown. */
export const RANGE_PRESETS: ReadonlyArray<{ key: Exclude<RangeKey, 'custom'>; label: string }> = [
  { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'year_to_date', label: 'Year to date' },
] as const;

/**
 * The ranges a SCHEDULE may use. Custom is deliberately absent: a fixed pair of
 * dates emailed every Monday sends the same numbers forever, which reads as a
 * broken report rather than as a choice the sender made.
 */
export const SCHEDULABLE_RANGE_KEYS = RANGE_PRESETS.map((r) => r.key);

/** `YYYY-MM-DD` for an instant, as the company's calendar sees it. */
function dayKeyAt(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Midnight at the start of that calendar day, as a real UTC instant. */
function dayStartMs(key: string, offsetMinutes: number): number {
  return Date.parse(`${key}T00:00:00.000Z`) - offsetMinutes * 60_000;
}

/**
 * Move a day key by whole days.
 *
 * Deliberately arithmetic on the DATE rather than on an instant: adding 24
 * hours across a daylight-saving change lands on the same calendar day twice
 * (or skips one), which would give the volume chart a duplicated or missing
 * column twice a year.
 */
function shiftDayKey(key: string, deltaDays: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + deltaDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Whole days from `a` to `b`, both day keys. */
function dayKeySpan(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / MS_PER_DAY);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date, so `2026-02-31` is rejected rather than rolled. */
function isValidDayKey(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function prettyDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

/**
 * Build a range from its first and last calendar day.
 *
 * `until` is the start of the day AFTER `lastKey`, so a window is a half-open
 * interval and a conversation started at 23:59 on the last day is inside it.
 * That upper bound is then clamped to "now": a report cannot cover the future,
 * and letting `period_end` run ahead of the clock would make a delivery record
 * claim to summarise days that have not happened.
 */
function rangeFromDays(
  key: RangeKey,
  label: string,
  firstKey: string,
  lastKey: string,
  offsetMinutes: number,
  nowMs: number,
  notice?: string,
): ReportRange {
  const days = dayKeySpan(firstKey, lastKey) + 1;
  const untilMs = Math.min(dayStartMs(shiftDayKey(lastKey, 1), offsetMinutes), nowMs);
  const sinceMs = dayStartMs(firstKey, offsetMinutes);
  return {
    key,
    label,
    since: new Date(sinceMs).toISOString(),
    until: new Date(Math.max(untilMs, sinceMs)).toISOString(),
    days,
    offsetMinutes,
    dayKeys: Array.from({ length: days }, (_, i) => shiftDayKey(firstKey, i)),
    notice,
  };
}

/**
 * A rolling "last N days" window.
 *
 * Kept genuinely rolling — `now` minus N times twenty-four hours — because that
 * is what the three buttons on this page have always meant, and quietly
 * redefining them as calendar days would change every number a customer has
 * been watching. The day keys still end on today, so the chart is unchanged.
 */
function rollingRange(key: RangeKey, label: string, n: number, offsetMinutes: number, nowMs: number): ReportRange {
  const lastKey = dayKeyAt(nowMs, offsetMinutes);
  return {
    key,
    label,
    since: new Date(nowMs - n * MS_PER_DAY).toISOString(),
    until: new Date(nowMs).toISOString(),
    days: n,
    offsetMinutes,
    dayKeys: Array.from({ length: n }, (_, i) => shiftDayKey(lastKey, i - (n - 1))),
  };
}

export interface RangeRequest {
  /** `?range=` — anything unrecognised falls back to the 30-day default. */
  key?: string | null;
  /** `?from=` / `?to=`, `YYYY-MM-DD`, only read when the key is `custom`. */
  from?: string | null;
  to?: string | null;
}

/** The three windows this page offered before ranges had names. */
const LEGACY_DAYS: Record<string, RangeKey> = {
  '7': 'last_7',
  '30': 'last_30',
  '90': 'last_90',
};

/**
 * Read a range out of a query string, honouring the `?days=` links this page
 * used to hand out.
 *
 * Those links are in people's bookmarks, in saved spreadsheets' provenance and
 * in the odd email — dropping them would silently answer a different question
 * than the one the URL asks. `?range=` wins when both are present.
 */
export function rangeRequestFrom(params: {
  range?: string | null;
  days?: string | null;
  from?: string | null;
  to?: string | null;
}): RangeRequest {
  return {
    key: params.range ?? (params.days ? (LEGACY_DAYS[params.days] ?? null) : null),
    from: params.from,
    to: params.to,
  };
}

/**
 * Turn what arrived in the URL (or in a schedule row) into a bounded window.
 *
 * THIS IS THE VALIDATION BOUNDARY. Callers pass raw strings; everything past
 * this function has a range that is parseable, ordered, no longer than
 * `MAX_RANGE_DAYS` and never extends into the future. Nothing here throws — a
 * report page that 500s because someone edited a query string is worse than one
 * that shows last month and says why.
 */
export function resolveRange(
  request: RangeRequest,
  offsetMinutes = 0,
  now: Date = new Date(),
): ReportRange {
  const nowMs = now.getTime();
  const todayKey = dayKeyAt(nowMs, offsetMinutes);
  const [year, month] = todayKey.split('-').map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (request.key) {
    case 'last_7':
      return rollingRange('last_7', 'Last 7 days', 7, offsetMinutes, nowMs);
    case 'last_90':
      return rollingRange('last_90', 'Last 90 days', 90, offsetMinutes, nowMs);

    case 'this_month':
      return rangeFromDays(
        'this_month',
        `This month (${MONTH_NAMES[m - 1]} ${y})`,
        `${y}-${pad(m)}-01`,
        todayKey,
        offsetMinutes,
        nowMs,
      );

    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const first = `${py}-${pad(pm)}-01`;
      // The day before the 1st of this month, which is the last day of the
      // previous one whatever its length and whether or not it is a leap year.
      const last = shiftDayKey(`${y}-${pad(m)}-01`, -1);
      return rangeFromDays(
        'last_month',
        `Last month (${MONTH_NAMES[pm - 1]} ${py})`,
        first,
        last,
        offsetMinutes,
        nowMs,
      );
    }

    case 'this_quarter': {
      const quarter = Math.floor((m - 1) / 3);
      return rangeFromDays(
        'this_quarter',
        `This quarter (Q${quarter + 1} ${y})`,
        `${y}-${pad(quarter * 3 + 1)}-01`,
        todayKey,
        offsetMinutes,
        nowMs,
      );
    }

    case 'year_to_date':
      return rangeFromDays('year_to_date', `Year to date (${y})`, `${y}-01-01`, todayKey, offsetMinutes, nowMs);

    case 'custom': {
      const from = (request.from ?? '').trim();
      const to = (request.to ?? '').trim();
      if (!isValidDayKey(from) || !isValidDayKey(to)) {
        return {
          ...rollingRange('last_30', 'Last 30 days', 30, offsetMinutes, nowMs),
          notice: 'That custom range was not two valid dates, so the last 30 days are shown instead.',
        };
      }
      if (dayKeySpan(from, to) < 0) {
        return {
          ...rollingRange('last_30', 'Last 30 days', 30, offsetMinutes, nowMs),
          notice: 'The end date came before the start date, so the last 30 days are shown instead.',
        };
      }

      // A range may not run into the future, and may not be longer than the
      // cap. Both corrections keep the END the customer asked for and move the
      // start, because the recent end of a window is the half anybody looks at.
      let notice: string | undefined;
      let last = to;
      if (dayKeySpan(todayKey, last) > 0) {
        last = todayKey;
        notice = 'The end date was in the future, so the range stops today.';
      }
      let first = from;
      if (dayKeySpan(first, last) + 1 > MAX_RANGE_DAYS) {
        first = shiftDayKey(last, -(MAX_RANGE_DAYS - 1));
        notice = `A range can cover at most ${MAX_RANGE_DAYS} days, so this one starts on ${prettyDay(first)}.`;
      }
      return rangeFromDays(
        'custom',
        `${prettyDay(first)} – ${prettyDay(last)}`,
        first,
        last,
        offsetMinutes,
        nowMs,
        notice,
      );
    }

    default:
      return rollingRange('last_30', 'Last 30 days', 30, offsetMinutes, nowMs);
  }
}

/**
 * The company's UTC offset right now, for deciding where a calendar day starts.
 *
 * `getCompanyCoreRow()` is React's per-request memo and the dashboard layout
 * already calls it on every page, so reading the timezone through it costs this
 * page NO extra round trip — which matters, because on this deployment one
 * round trip is about a quarter of a second of blank screen.
 */
export async function getCompanyRangeOffset(): Promise<number> {
  try {
    const row = (await getCompanyCoreRow()) as { timezone?: string | null } | null;
    const timeZone = row?.timezone || null;
    return timeZone ? zoneOffsetMinutes(new Date(), timeZone) : 0;
  } catch {
    // A blip reading the company row must not fail the whole report. UTC is the
    // behaviour this page had before timezones were considered at all.
    return 0;
  }
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Rows come back from PostgREST untyped; narrow once at the boundary. */
function rows<T>(res: { data: unknown }): T[] {
  return (res.data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Shared conversation/message shapes
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  channel: string | null;
  status: string | null;
  started_at: string;
  visitor_id?: string | null;
  assigned_agent_id?: string | null;
}

interface MessageRow {
  conversation_id: string;
  channel?: string | null;
  sender_type: string;
  sender_id?: string | null;
  created_at: string;
}

/** Conversation ids that a human agent actually touched. */
function humanTouchedIds(conversations: ConversationRow[], messages: MessageRow[]): Set<string> {
  const touched = new Set<string>();
  for (const c of conversations) if (ESCALATED_STATUSES.has(c.status ?? '')) touched.add(c.id);
  for (const m of messages) if (m.sender_type === 'agent') touched.add(m.conversation_id);
  return touched;
}

// ===========================================================================
// 1. Overview
// ===========================================================================

/**
 * Channel-level reporting over `range`.
 *
 * Aggregation is done in memory over bounded page reads rather than with one
 * grouped SQL statement per metric: PostgREST cannot express GROUP BY without a
 * database function, and a handful of round trips of at most a few thousand
 * narrow rows is both faster and simpler than that many RPCs to maintain.
 *
 * THE COMPANY ID
 * Every reader below comes in two halves. The exported `get…` takes its company
 * from the SESSION and is what the dashboard calls; the `build…` beneath it
 * takes an explicit company id and is what the scheduled-report cron calls,
 * because a cron run has no session to read one from. The explicit form must
 * only ever be handed an id the caller already owns — the cron takes it off the
 * schedule row it is processing. The service client bypasses row-level
 * security, so that argument IS the tenant boundary.
 */
export async function getReportsSnapshot(range: ReportRange): Promise<ReportsSnapshot> {
  return buildReportsSnapshot(await getCompanyId(), range);
}

export async function buildReportsSnapshot(
  companyId: string,
  range: ReportRange,
): Promise<ReportsSnapshot> {
  const sb = createSupabaseServiceClient();
  const { since, until } = range;

  const [convoRes, messageRes, leadRes, csatRes, flowEventRes, flowRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,channel,status,started_at,visitor_id')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .lt('started_at', until)
      .limit(LIMITS.conversations),
    // `conversation_id` and `sender_type` ride along on the existing read so
    // first-contact resolution and the AI/human split cost no extra round trip.
    sb
      .from('messages')
      .select('conversation_id,channel,sender_type,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.messages),
    sb
      .from('leads')
      .select('conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.leads),
    sb
      .from('conversation_ratings')
      .select('rating,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.ratings),
    sb
      .from('flow_node_events')
      .select('flow_id,event,conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.flowEvents),
    sb.from('flows').select('id,name').eq('company_id', companyId).limit(LIMITS.rules),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const leads = rows<{ conversation_id: string | null }>(leadRes);

  const channelOf = new Map<string, string>();
  for (const c of conversations) channelOf.set(c.id, c.channel ?? 'web_chat');

  const stats = new Map<string, ChannelReportRow>();
  const row = (channel: string): ChannelReportRow => {
    const existing = stats.get(channel);
    if (existing) return existing;
    const created: ChannelReportRow = {
      channel,
      label: CHANNEL_LABELS[channel] ?? channel,
      conversations: 0,
      messages: 0,
      aiHandled: 0,
      escalated: 0,
      leads: 0,
      automationRate: 0,
    };
    stats.set(channel, created);
    return created;
  };

  for (const c of conversations) {
    const entry = row(c.channel ?? 'web_chat');
    entry.conversations += 1;
    if (ESCALATED_STATUSES.has(c.status ?? '')) entry.escalated += 1;
    else entry.aiHandled += 1;
  }
  for (const m of messages) row(m.channel ?? 'web_chat').messages += 1;
  for (const l of leads) {
    const channel = l.conversation_id ? channelOf.get(l.conversation_id) : undefined;
    row(channel ?? 'web_chat').leads += 1;
  }

  const channels = [...stats.values()]
    .map((c) => ({
      ...c,
      automationRate: percentage(c.aiHandled, c.conversations),
    }))
    .sort((a, b) => b.conversations - a.conversations);

  // Daily series — one bucket per day so the chart has no gaps. The buckets
  // come from the range, which already enumerated its own days, so a 366-day
  // custom window is still the same two reads a 7-day one is.
  const dailyMap = new Map(
    range.dayKeys.map((d) => [d, { date: d, conversations: 0, messages: 0 }]),
  );
  // Timestamps are bucketed in the company's calendar, not UTC's, so the column
  // labelled "1 March" holds the conversations the shop had on the 1st of March.
  const bucketOf = (iso: string) => dailyMap.get(dayKeyAt(Date.parse(iso), range.offsetMinutes));
  for (const c of conversations) {
    const bucket = bucketOf(c.started_at);
    if (bucket) bucket.conversations += 1;
  }
  for (const m of messages) {
    const bucket = bucketOf(m.created_at);
    if (bucket) bucket.messages += 1;
  }

  const ratings = rows<{ rating: number | null }>(csatRes)
    .map((r) => r.rating)
    .filter((r): r is number => typeof r === 'number');

  const flowNames = new Map(rows<{ id: string; name: string }>(flowRes).map((f) => [f.id, f.name]));
  // A "start" is one conversation entering the flow, not one block being
  // entered. Counting `entered` events directly divided completions by the
  // number of blocks people walked through, so a longer flow always looked
  // worse and the rate could never reach 100%.
  const flowStats = new Map<string, { starts: Set<string>; completions: Set<string> }>();
  for (const e of rows<{ flow_id: string; event: string; conversation_id: string | null }>(flowEventRes)) {
    const entry = flowStats.get(e.flow_id) ?? { starts: new Set<string>(), completions: new Set<string>() };
    // Events from a deleted conversation keep their own identity so they are
    // still counted once each rather than collapsing into one.
    const key = e.conversation_id ?? `anon:${entry.starts.size}:${e.event}`;
    if (e.event === 'entered') entry.starts.add(key);
    if (e.event === 'completed') entry.completions.add(key);
    flowStats.set(e.flow_id, entry);
  }

  const totalConversations = conversations.length;
  const totalEscalated = channels.reduce((sum, c) => sum + c.escalated, 0);

  return {
    range,
    totals: {
      conversations: totalConversations,
      messages: messages.length,
      leads: leads.length,
      escalated: totalEscalated,
      automationRate: containmentRate(totalConversations, totalEscalated),
      csatAverage: average(ratings),
      csatResponses: ratings.length,
    },
    channels,
    daily: [...dailyMap.values()],
    flows: [...flowStats.entries()]
      .map(([flowId, s]) => {
        const starts = s.starts.size;
        const completions = s.completions.size;
        return {
          flowId,
          name: flowNames.get(flowId) ?? 'Deleted flow',
          starts,
          completions,
          // Capped: a conversation can complete a flow it entered in an earlier
          // period, which would otherwise read as over 100%.
          completionRate: starts === 0 ? 0 : Math.min(100, percentage(completions, starts)),
        };
      })
      .sort((a, b) => b.starts - a.starts)
      .slice(0, 10),
    heatmap: buildHourHeatmap(conversations.map((c) => c.started_at)),
    fcr: firstContactResolution(
      conversations.map((c) => ({
        id: c.id,
        visitorId: c.visitor_id ?? null,
        startedAt: c.started_at,
        status: c.status,
      })),
      humanTouchedIds(conversations, messages),
    ),
  };
}

// ===========================================================================
// 2. Team
// ===========================================================================

export interface AgentReportRow {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  conversations: number;
  messagesSent: number;
  /** Median minutes to the first agent reply, or null when never measured. */
  medianFirstResponseMinutes: number | null;
  firstResponseSamples: number;
  csatAverage: number | null;
  csatResponses: number;
  openLoad: number;
}

export interface TeamReport {
  range: ReportRange;
  agents: AgentReportRow[];
  totals: {
    agentsActive: number;
    conversationsHandled: number;
    messagesSent: number;
    medianFirstResponseMinutes: number | null;
    unassignedOpen: number;
  };
  /** True when at least one figure came from the SLA clock rather than the fallback. */
  slaEventsUsed: boolean;
}

/**
 * Per-agent performance.
 *
 * First response is read from `sla_events` where it exists and reconstructed
 * from the message timeline where it does not. That fallback is not a nicety:
 * `sla_states` is only created for conversations covered by an active SLA
 * policy, so a company that never configured one would otherwise see a blank
 * column and conclude the report is broken rather than that the clock is off.
 */
export async function getTeamReport(range: ReportRange): Promise<TeamReport> {
  return buildTeamReport(await getCompanyId(), range);
}

export async function buildTeamReport(companyId: string, range: ReportRange): Promise<TeamReport> {
  const sb = createSupabaseServiceClient();
  const { since, until } = range;

  const [convoRes, messageRes, ratingRes, slaRes, memberRes, openRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,channel,status,started_at,assigned_agent_id')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .lt('started_at', until)
      .limit(LIMITS.conversations),
    sb
      .from('messages')
      .select('conversation_id,sender_type,sender_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.messages),
    sb
      .from('conversation_ratings')
      .select('conversation_id,rating')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.ratings),
    sb
      .from('sla_events')
      .select('conversation_id,event,minutes,created_at')
      .eq('company_id', companyId)
      .eq('event', 'responded')
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.slaEvents),
    sb.from('company_users').select('user_id,role').eq('company_id', companyId).limit(LIMITS.members),
    // Open load is "right now", not "in the window", so it is deliberately not
    // date-filtered — a manager reassigning work cares about the current queue.
    sb
      .from('conversations')
      .select('assigned_agent_id,status')
      .eq('company_id', companyId)
      .in('status', OPEN_STATUSES)
      .limit(LIMITS.conversations),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const members = rows<{ user_id: string; role: string }>(memberRes);

  // The ONE query on this page with no `company_id` filter, because `users` is
  // the global identity table and has no such column. It is still tenant-safe:
  // the id list comes from `company_users` filtered to this company above, so
  // this can only ever resolve names for people already proven to be members.
  // It is a second round trip rather than a PostgREST embed so the filter stays
  // visible here instead of hiding inside a relationship hint.
  const userIds = members.map((m) => m.user_id);
  const userRes = userIds.length
    ? await sb.from('users').select('id,email,full_name').in('id', userIds).limit(LIMITS.members)
    : { data: [] };
  const profiles = new Map(
    rows<{ id: string; email: string | null; full_name: string | null }>(userRes).map((u) => [u.id, u]),
  );

  // --- per-conversation timeline ------------------------------------------
  const firstVisitorAt = new Map<string, number>();
  const firstAgentAt = new Map<string, number>();
  const firstAgentBy = new Map<string, string>();
  const messagesByAgent = new Map<string, number>();
  const convosByAgent = new Map<string, Set<string>>();

  const touch = (agentId: string): Set<string> => {
    const existing = convosByAgent.get(agentId);
    if (existing) return existing;
    const created = new Set<string>();
    convosByAgent.set(agentId, created);
    return created;
  };

  for (const m of messages) {
    const at = new Date(m.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (m.sender_type === 'visitor') {
      const current = firstVisitorAt.get(m.conversation_id);
      if (current === undefined || at < current) firstVisitorAt.set(m.conversation_id, at);
      continue;
    }
    if (m.sender_type !== 'agent') continue;
    const agentId = m.sender_id ?? null;
    if (agentId) {
      messagesByAgent.set(agentId, (messagesByAgent.get(agentId) ?? 0) + 1);
      touch(agentId).add(m.conversation_id);
    }
    const current = firstAgentAt.get(m.conversation_id);
    if (current === undefined || at < current) {
      firstAgentAt.set(m.conversation_id, at);
      if (agentId) firstAgentBy.set(m.conversation_id, agentId);
    }
  }

  // An assignment counts as handling even with no reply yet, so a conversation
  // sitting unanswered in someone's queue still shows up against their name.
  for (const c of conversations) if (c.assigned_agent_id) touch(c.assigned_agent_id).add(c.id);

  // --- first response times ------------------------------------------------
  const slaMinutes = new Map<string, number>();
  for (const e of rows<{ conversation_id: string | null; minutes: number | null }>(slaRes)) {
    if (!e.conversation_id || e.minutes === null || e.minutes === undefined) continue;
    const current = slaMinutes.get(e.conversation_id);
    if (current === undefined || e.minutes < current) slaMinutes.set(e.conversation_id, e.minutes);
  }

  const responseByAgent = new Map<string, number[]>();
  const allResponses: number[] = [];
  for (const conversationId of new Set([...firstAgentAt.keys(), ...slaMinutes.keys()])) {
    const fromSla = slaMinutes.get(conversationId);
    let minutes: number | null = fromSla ?? null;
    if (minutes === null) {
      const askedAt = firstVisitorAt.get(conversationId);
      const repliedAt = firstAgentAt.get(conversationId);
      if (askedAt !== undefined && repliedAt !== undefined && repliedAt >= askedAt) {
        minutes = (repliedAt - askedAt) / 60_000;
      }
    }
    if (minutes === null || minutes < 0) continue;
    allResponses.push(minutes);
    const agentId = firstAgentBy.get(conversationId);
    if (!agentId) continue;
    const list = responseByAgent.get(agentId);
    if (list) list.push(minutes);
    else responseByAgent.set(agentId, [minutes]);
  }

  // --- CSAT per agent -------------------------------------------------------
  const ratingByConversation = new Map<string, number>();
  for (const r of rows<{ conversation_id: string; rating: number | null }>(ratingRes)) {
    if (typeof r.rating === 'number') ratingByConversation.set(r.conversation_id, r.rating);
  }

  // --- open load ------------------------------------------------------------
  const openByAgent = new Map<string, number>();
  let unassignedOpen = 0;
  for (const c of rows<{ assigned_agent_id: string | null }>(openRes)) {
    if (!c.assigned_agent_id) unassignedOpen += 1;
    else openByAgent.set(c.assigned_agent_id, (openByAgent.get(c.assigned_agent_id) ?? 0) + 1);
  }

  const agents: AgentReportRow[] = members
    .map((member) => {
      const profile = profiles.get(member.user_id);
      const handled = convosByAgent.get(member.user_id) ?? new Set<string>();
      const ratings = [...handled]
        .map((id) => ratingByConversation.get(id))
        .filter((r): r is number => typeof r === 'number');
      const responses = responseByAgent.get(member.user_id) ?? [];
      return {
        userId: member.user_id,
        name: profile?.full_name || profile?.email || 'Removed teammate',
        email: profile?.email ?? null,
        role: humanizeToken(member.role),
        conversations: handled.size,
        messagesSent: messagesByAgent.get(member.user_id) ?? 0,
        medianFirstResponseMinutes: median(responses),
        firstResponseSamples: responses.length,
        csatAverage: average(ratings),
        csatResponses: ratings.length,
        openLoad: openByAgent.get(member.user_id) ?? 0,
      };
    })
    .sort((a, b) => b.conversations - a.conversations || b.messagesSent - a.messagesSent);

  return {
    range,
    agents,
    totals: {
      agentsActive: agents.filter((a) => a.conversations > 0 || a.messagesSent > 0).length,
      conversationsHandled: new Set([...convosByAgent.values()].flatMap((s) => [...s])).size,
      messagesSent: [...messagesByAgent.values()].reduce((a, b) => a + b, 0),
      medianFirstResponseMinutes: median(allResponses),
      unassignedOpen,
    },
    slaEventsUsed: slaMinutes.size > 0,
  };
}

// ===========================================================================
// 3. Customers
// ===========================================================================

export interface CustomerRow {
  key: string;
  name: string;
  contact: string | null;
  orders: number;
  value: number;
  currency: string;
  /** True when the totals mix currencies and were therefore not converted. */
  mixedCurrency: boolean;
}

export interface CustomersReport {
  range: ReportRange;
  funnel: FunnelStage[];
  visitors: VisitorSplit;
  leadsByStatus: Array<{ status: string; label: string; count: number }>;
  topCustomers: CustomerRow[];
  appointments: {
    booked: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
    completionRate: number;
  };
  /** No store connected, so the customer table can only see chat orders. */
  storeOrdersPresent: boolean;
}

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  converted: 'Converted',
  closed: 'Closed',
};

/** Qualified is cumulative — a converted lead was qualified on its way there. */
const QUALIFIED_STATUSES = new Set(['qualified', 'converted']);

interface OrderLike {
  name: string | null;
  email: string | null;
  phone: string | null;
  total: number;
  currency: string;
  status: string | null;
}

function rankCustomers(orders: OrderLike[], limit = 10): CustomerRow[] {
  const byCustomer = new Map<string, CustomerRow & { currencies: Set<string> }>();
  for (const order of orders) {
    const contact = (order.email || order.phone || '').trim().toLowerCase();
    const key = contact || (order.name || '').trim().toLowerCase();
    if (!key) continue;
    const existing = byCustomer.get(key);
    if (existing) {
      existing.orders += 1;
      existing.value += order.total;
      existing.currencies.add(order.currency);
      if (!existing.name && order.name) existing.name = order.name;
    } else {
      byCustomer.set(key, {
        key,
        name: order.name || order.email || order.phone || 'Unnamed customer',
        contact: order.email || order.phone || null,
        orders: 1,
        value: order.total,
        currency: order.currency,
        currencies: new Set([order.currency]),
        mixedCurrency: false,
      });
    }
  }
  return [...byCustomer.values()]
    .map(({ currencies, ...row }) => ({ ...row, mixedCurrency: currencies.size > 1 }))
    .sort((a, b) => b.value - a.value || b.orders - a.orders)
    .slice(0, limit);
}

/** Lead funnel, repeat visitors, best customers and booking follow-through. */
export async function getCustomersReport(range: ReportRange): Promise<CustomersReport> {
  return buildCustomersReport(await getCompanyId(), range);
}

export async function buildCustomersReport(
  companyId: string,
  range: ReportRange,
): Promise<CustomersReport> {
  const sb = createSupabaseServiceClient();
  const { since, until } = range;

  const [convoRes, leadRes, apptRes, chatOrderRes, storeOrderRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,visitor_id,started_at')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .lt('started_at', until)
      .limit(LIMITS.conversations),
    sb
      .from('leads')
      .select('id,status,conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.leads),
    sb
      .from('appointments')
      .select('id,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.appointments),
    sb
      .from('chat_orders')
      .select('id,customer_name,customer_email,customer_phone,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.orders),
    sb
      .from('synced_orders')
      .select('id,customer_name,customer_email,customer_phone,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.orders),
  ]);

  const conversations = rows<{ visitor_id: string | null }>(convoRes);
  const leads = rows<{ status: string | null }>(leadRes);
  const appointments = rows<{ status: string | null }>(apptRes);

  const statusCounts = new Map<string, number>();
  for (const l of leads) {
    const status = l.status ?? 'new';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const qualified = leads.filter((l) => QUALIFIED_STATUSES.has(l.status ?? '')).length;
  const converted = leads.filter((l) => l.status === 'converted').length;

  const apptCount = (status: string) => appointments.filter((a) => a.status === status).length;
  const completed = apptCount('completed');

  type OrderRow = {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    total: unknown;
    currency: string | null;
    status: string | null;
  };
  const toOrderLike = (o: OrderRow): OrderLike => ({
    name: o.customer_name,
    email: o.customer_email,
    phone: o.customer_phone,
    total: num(o.total),
    currency: o.currency ?? 'USD',
    status: o.status,
  });
  const storeOrders = rows<OrderRow>(storeOrderRes);
  const allOrders = [...rows<OrderRow>(chatOrderRes), ...storeOrders]
    .map(toOrderLike)
    .filter((o) => o.status !== 'cancelled');

  return {
    range,
    funnel: buildFunnel([
      {
        key: 'conversations',
        label: 'Conversations',
        count: conversations.length,
        hint: 'Every chat started in this period.',
      },
      { key: 'leads', label: 'Leads captured', count: leads.length, hint: 'Contact details collected.' },
      { key: 'qualified', label: 'Qualified', count: qualified, hint: 'Marked qualified or converted.' },
      { key: 'converted', label: 'Converted', count: converted, hint: 'Marked converted.' },
    ]),
    visitors: splitVisitors(conversations.map((c) => c.visitor_id)),
    leadsByStatus: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, label: labelFor(LEAD_STATUS_LABELS, status), count }))
      .sort((a, b) => b.count - a.count),
    topCustomers: rankCustomers(allOrders),
    appointments: {
      booked: appointments.length,
      confirmed: apptCount('confirmed'),
      completed,
      cancelled: apptCount('cancelled'),
      noShow: apptCount('no_show'),
      completionRate: percentage(completed, appointments.length),
    },
    storeOrdersPresent: storeOrders.length > 0,
  };
}

// ===========================================================================
// 4. Assistant
// ===========================================================================

export interface AssistantReport {
  range: ReportRange;
  conversations: number;
  containedConversations: number;
  containmentRate: number;
  averageMessagesToResolution: number | null;
  resolvedConversations: number;
  csat: {
    aiOnly: { average: number | null; responses: number };
    humanTouched: { average: number | null; responses: number };
  };
  unanswered: Array<{ question: string; count: number }>;
  unansweredTotal: number;
  /** False when the AI quality log has no rows at all for this period. */
  qualityLoggingActive: boolean;
  topics: TopicCount[];
  topicSampleSize: number;
}

/**
 * Bot performance.
 *
 * "Unanswered" comes from `answer_quality_logs.failure_reason`, which the chat
 * engine already writes, rather than from re-matching a phrase against reply
 * text. The engine's own `inferFailureReason` decides what "the assistant did
 * not know" means; re-implementing that guess here would produce a second,
 * quietly different definition of the same metric — and it would break the
 * moment the fallback wording is reworded or translated.
 */
export async function getAssistantReport(range: ReportRange): Promise<AssistantReport> {
  return buildAssistantReport(await getCompanyId(), range);
}

export async function buildAssistantReport(
  companyId: string,
  range: ReportRange,
): Promise<AssistantReport> {
  const sb = createSupabaseServiceClient();
  const { since, until } = range;

  const [convoRes, messageRes, ratingRes, qualityRes, qualityAnyRes, visitorTextRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,status,started_at')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .lt('started_at', until)
      .limit(LIMITS.conversations),
    sb
      .from('messages')
      .select('conversation_id,sender_type,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.messages),
    sb
      .from('conversation_ratings')
      .select('conversation_id,rating')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.ratings),
    sb
      .from('answer_quality_logs')
      .select('question,failure_reason,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .in('failure_reason', ['missing_info', 'weak_retrieval'])
      .order('created_at', { ascending: false })
      .limit(LIMITS.qualityLogs),
    // One cheap probe so an empty list can say "logging is off" instead of
    // "the assistant answered everything".
    sb
      .from('answer_quality_logs')
      .select('id')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(1),
    // Message bodies are the heaviest rows on this page, so the topic sample is
    // capped well below the other reads and takes the most recent slice.
    sb
      .from('messages')
      .select('content_text,created_at')
      .eq('company_id', companyId)
      .eq('sender_type', 'visitor')
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: false })
      .limit(LIMITS.visitorText),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const touched = humanTouchedIds(conversations, messages);

  const messageCounts = new Map<string, number>();
  for (const m of messages) messageCounts.set(m.conversation_id, (messageCounts.get(m.conversation_id) ?? 0) + 1);

  const resolved = conversations.filter((c) => c.status === 'closed');
  const resolutionLengths = resolved.map((c) => messageCounts.get(c.id) ?? 0).filter((n) => n > 0);

  const aiOnly: number[] = [];
  const withHuman: number[] = [];
  for (const r of rows<{ conversation_id: string; rating: number | null }>(ratingRes)) {
    if (typeof r.rating !== 'number') continue;
    if (touched.has(r.conversation_id)) withHuman.push(r.rating);
    else aiOnly.push(r.rating);
  }

  const quality = rows<{ question: string | null }>(qualityRes);
  const visitorTexts = rows<{ content_text: string | null }>(visitorTextRes).map((m) => m.content_text);

  return {
    range,
    conversations: conversations.length,
    containedConversations: conversations.length - touched.size,
    containmentRate: containmentRate(conversations.length, touched.size),
    averageMessagesToResolution: average(resolutionLengths),
    resolvedConversations: resolved.length,
    csat: {
      aiOnly: { average: average(aiOnly), responses: aiOnly.length },
      humanTouched: { average: average(withHuman), responses: withHuman.length },
    },
    unanswered: groupQuestions(quality.map((q) => q.question)),
    unansweredTotal: quality.length,
    qualityLoggingActive: rows<{ id: string }>(qualityAnyRes).length > 0,
    topics: topTopics(visitorTexts),
    topicSampleSize: visitorTexts.filter(Boolean).length,
  };
}

// ===========================================================================
// 5. Sales & campaigns
// ===========================================================================

export interface SalesReport {
  range: ReportRange;
  orders: {
    total: number;
    fromChat: number;
    chatAttributionRate: number;
    storeSynced: number;
  };
  revenueByCurrency: Array<{ currency: string; total: number; paid: number; orders: number }>;
  carts: {
    created: number;
    abandoned: number;
    recoveryMessaged: number;
    recovered: number;
    recoveryRate: number;
    /** No active `cart_abandoned` rule means the detector never runs. */
    detectorActive: boolean;
  };
  broadcasts: {
    campaigns: number;
    recipients: number;
    failed: number;
    byChannel: Array<{ channel: string; label: string; campaigns: number; recipients: number; failed: number }>;
    recent: Array<{ id: string; channel: string; label: string; status: string; sent: number; sentAt: string | null; subject: string | null }>;
  };
  automations: Array<{
    ruleId: string;
    name: string;
    trigger: string;
    channel: string;
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    successRate: number;
  }>;
  automationRunsTotal: number;
}

const PAID_ORDER_STATUSES = new Set(['paid', 'fulfilled']);

/** Chat-attributed orders, cart recovery, broadcasts and automation outcomes. */
export async function getSalesReport(range: ReportRange): Promise<SalesReport> {
  return buildSalesReport(await getCompanyId(), range);
}

export async function buildSalesReport(companyId: string, range: ReportRange): Promise<SalesReport> {
  const sb = createSupabaseServiceClient();
  const { since, until } = range;

  const [chatOrderRes, storeOrderRes, cartRes, broadcastRes, runRes, ruleRes, abandonRuleRes] = await Promise.all([
    sb
      .from('chat_orders')
      .select('id,conversation_id,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.orders),
    sb
      .from('synced_orders')
      .select('id,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.orders),
    sb
      .from('chat_carts')
      .select('id,status,subtotal,currency,abandoned_at,recovered_at,recovery_sent_at,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.carts),
    sb
      .from('broadcasts')
      .select('id,channel,status,sent_count,subject,created_at,sent_at,error')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .order('created_at', { ascending: false })
      .limit(LIMITS.broadcasts),
    sb
      .from('automation_runs')
      .select('rule_id,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .lt('created_at', until)
      .limit(LIMITS.automationRuns),
    sb
      .from('automation_rules')
      .select('id,name,trigger_event,channel')
      .eq('company_id', companyId)
      .limit(LIMITS.rules),
    sb
      .from('automation_rules')
      .select('id')
      .eq('company_id', companyId)
      .eq('trigger_event', 'cart_abandoned')
      .eq('is_active', true)
      .limit(1),
  ]);

  interface ChatOrder {
    conversation_id: string | null;
    total: unknown;
    currency: string | null;
    status: string | null;
  }
  const chatOrders = rows<ChatOrder>(chatOrderRes);
  const storeOrders = rows<{ total: unknown; currency: string | null; status: string | null }>(storeOrderRes);

  const money = new Map<string, { currency: string; total: number; paid: number; orders: number }>();
  const addMoney = (currency: string | null, total: unknown, status: string | null) => {
    if (status === 'cancelled') return;
    const key = currency ?? 'USD';
    const entry = money.get(key) ?? { currency: key, total: 0, paid: 0, orders: 0 };
    const value = num(total);
    entry.total += value;
    entry.orders += 1;
    if (PAID_ORDER_STATUSES.has(status ?? '')) entry.paid += value;
    money.set(key, entry);
  };
  for (const o of chatOrders) addMoney(o.currency, o.total, o.status);
  for (const o of storeOrders) addMoney(o.currency, o.total, o.status);

  const fromChat = chatOrders.filter((o) => Boolean(o.conversation_id)).length;
  const totalOrders = chatOrders.length + storeOrders.length;

  const carts = rows<{
    status: string | null;
    abandoned_at: string | null;
    recovered_at: string | null;
    recovery_sent_at: string | null;
  }>(cartRes);
  const abandoned = carts.filter((c) => Boolean(c.abandoned_at)).length;
  const recovered = carts.filter((c) => Boolean(c.recovered_at)).length;

  const broadcasts = rows<{
    id: string;
    channel: string;
    status: string;
    sent_count: number | null;
    subject: string | null;
    sent_at: string | null;
  }>(broadcastRes);

  const channelStats = new Map<string, { channel: string; label: string; campaigns: number; recipients: number; failed: number }>();
  for (const b of broadcasts) {
    const entry = channelStats.get(b.channel) ?? {
      channel: b.channel,
      label: labelFor(CHANNEL_LABELS, b.channel),
      campaigns: 0,
      recipients: 0,
      failed: 0,
    };
    entry.campaigns += 1;
    entry.recipients += num(b.sent_count);
    if (b.status === 'failed') entry.failed += 1;
    channelStats.set(b.channel, entry);
  }

  const ruleInfo = new Map(
    rows<{ id: string; name: string; trigger_event: string; channel: string }>(ruleRes).map((r) => [r.id, r]),
  );
  const runStats = new Map<string, { sent: number; pending: number; failed: number; skipped: number }>();
  const runs = rows<{ rule_id: string; status: string }>(runRes);
  for (const run of runs) {
    const entry = runStats.get(run.rule_id) ?? { sent: 0, pending: 0, failed: 0, skipped: 0 };
    if (run.status === 'sent') entry.sent += 1;
    else if (run.status === 'failed') entry.failed += 1;
    else if (run.status === 'skipped') entry.skipped += 1;
    else entry.pending += 1;
    runStats.set(run.rule_id, entry);
  }

  return {
    range,
    orders: {
      total: totalOrders,
      fromChat,
      chatAttributionRate: percentage(fromChat, totalOrders),
      storeSynced: storeOrders.length,
    },
    revenueByCurrency: [...money.values()]
      .map((m) => ({ ...m, total: Math.round(m.total * 100) / 100, paid: Math.round(m.paid * 100) / 100 }))
      .sort((a, b) => b.total - a.total),
    carts: {
      created: carts.length,
      abandoned,
      recoveryMessaged: carts.filter((c) => Boolean(c.recovery_sent_at)).length,
      recovered,
      recoveryRate: percentage(recovered, abandoned),
      detectorActive: rows<{ id: string }>(abandonRuleRes).length > 0,
    },
    broadcasts: {
      campaigns: broadcasts.length,
      recipients: broadcasts.reduce((sum, b) => sum + num(b.sent_count), 0),
      failed: broadcasts.filter((b) => b.status === 'failed').length,
      byChannel: [...channelStats.values()].sort((a, b) => b.recipients - a.recipients),
      recent: broadcasts.slice(0, 10).map((b) => ({
        id: b.id,
        channel: b.channel,
        label: labelFor(CHANNEL_LABELS, b.channel),
        status: humanizeToken(b.status),
        sent: num(b.sent_count),
        sentAt: b.sent_at,
        subject: b.subject,
      })),
    },
    automations: [...runStats.entries()]
      .map(([ruleId, s]) => {
        const rule = ruleInfo.get(ruleId);
        const attempted = s.sent + s.failed;
        return {
          ruleId,
          name: rule?.name || 'Deleted rule',
          trigger: humanizeToken(rule?.trigger_event ?? 'unknown'),
          channel: labelFor(CHANNEL_LABELS, rule?.channel),
          sent: s.sent,
          pending: s.pending,
          failed: s.failed,
          skipped: s.skipped,
          successRate: percentage(s.sent, attempted),
        };
      })
      .sort((a, b) => b.sent + b.failed - (a.sent + a.failed))
      .slice(0, 20),
    automationRunsTotal: runs.length,
  };
}

// ===========================================================================
// 6. Scheduled reports (migration 0082)
//
// A report nobody opens is a report nobody has. These rows say what to send,
// how often and to whom; `report_deliveries` says what actually happened, so a
// send that failed is on the screen next to the schedule that caused it rather
// than only in a server log nobody is reading.
// ===========================================================================

export const REPORT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'team', label: 'Team' },
  { key: 'customers', label: 'Customers' },
  { key: 'assistant', label: 'Assistant' },
  { key: 'sales', label: 'Sales & campaigns' },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]['key'];

export function isReportTab(value: unknown): value is ReportTab {
  return REPORT_TABS.some((t) => t.key === value);
}

export const SCHEDULE_FREQUENCIES = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' },
] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number]['key'];

/** Sunday first, matching `DAY_LABELS` in reports-metrics.ts and Postgres' dow. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** At most this many addresses per schedule — see the note on the save action. */
export const MAX_RECIPIENTS = 10;

export interface ScheduleCadence {
  frequency: ScheduleFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  sendHour: number;
}

export interface ReportScheduleRow extends ScheduleCadence {
  id: string;
  name: string;
  tab: ReportTab;
  tabLabel: string;
  rangeKey: string;
  rangeLabel: string;
  recipients: string[];
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  cadence: string;
}

export interface ReportDeliveryRow {
  id: string;
  scheduleId: string | null;
  scheduleName: string;
  tabLabel: string;
  rangeLabel: string;
  status: 'sent' | 'skipped' | 'failed';
  reason: string | null;
  /** The reason in words, because 'email_not_configured' is not an explanation. */
  reasonLabel: string | null;
  recipients: string[];
  createdAt: string;
}

/**
 * Why a send did not happen, in words an owner can act on.
 *
 * Every one of these names something the reader can go and fix, which is the
 * whole reason the delivery row exists — "failed" on its own sends them to
 * support, and support to the logs.
 */
const DELIVERY_REASONS: Record<string, string> = {
  email_not_configured:
    'No email provider is set up on this platform yet, so the report was built but not sent. Ask your provider to configure email.',
  no_recipients: 'This schedule has no recipients, so there was nobody to send to.',
  send_rejected:
    'The email provider rejected the message. Check the addresses and the provider settings.',
  report_failed:
    'The report could not be built for this period, so nothing was sent. It will be retried on the next run.',
};

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Every Monday at 07:00" — the cadence as a sentence, for the schedules list. */
export function describeCadence(cadence: ScheduleCadence): string {
  const at = `at ${String(cadence.sendHour).padStart(2, '0')}:00`;
  if (cadence.frequency === 'daily') return `Every day ${at}`;
  if (cadence.frequency === 'weekly') {
    return `Every ${WEEKDAY_NAMES[cadence.dayOfWeek] ?? 'Monday'} ${at}`;
  }
  return `On the ${ordinal(cadence.dayOfMonth)} of each month ${at}`;
}

/**
 * When this schedule is next due, as a real instant.
 *
 * The cadence is stored in the COMPANY's wall clock — "07:00 on Monday" has to
 * mean seven in the morning where the shop is — so the arithmetic is done on
 * the clock shifted by the company's offset and shifted back at the end. Using
 * `Date.UTC` on the shifted frame means day and month overflow (the 31st of a
 * 30-day month, December rolling into January) is handled by the platform
 * rather than by a calendar table maintained here.
 *
 * The offset is read at the moment of computing, so a schedule that spans a
 * daylight-saving change lands an hour out until its next send recomputes it.
 * That is a deliberate trade: the alternative is storing the zone rule itself
 * and re-deriving every pending schedule twice a year.
 *
 * `after` is strict — the returned instant is always later than it — so a
 * schedule that has just run cannot be picked up again by the same sweep.
 */
export function computeNextRunAt(
  cadence: ScheduleCadence,
  offsetMinutes: number,
  after: Date = new Date(),
): string {
  const wall = new Date(after.getTime() + offsetMinutes * 60_000);
  const y = wall.getUTCFullYear();
  const mo = wall.getUTCMonth();
  const d = wall.getUTCDate();
  const at = (yy: number, mm: number, dd: number) => Date.UTC(yy, mm, dd, cadence.sendHour, 0, 0, 0);

  let target: number;
  if (cadence.frequency === 'daily') {
    target = at(y, mo, d);
    if (target <= wall.getTime()) target = at(y, mo, d + 1);
  } else if (cadence.frequency === 'weekly') {
    const delta = (cadence.dayOfWeek - wall.getUTCDay() + 7) % 7;
    target = at(y, mo, d + delta);
    if (target <= wall.getTime()) target = at(y, mo, d + delta + 7);
  } else {
    target = at(y, mo, cadence.dayOfMonth);
    if (target <= wall.getTime()) target = at(y, mo + 1, cadence.dayOfMonth);
  }
  return new Date(target - offsetMinutes * 60_000).toISOString();
}

/** The database row, before it is turned into something the UI can render. */
interface ScheduleDbRow {
  id: string;
  company_id: string;
  name: string;
  tab: string;
  range_key: string;
  frequency: string;
  day_of_week: number;
  day_of_month: number;
  send_hour: number;
  recipients: string[] | null;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
}

function toScheduleRow(row: ScheduleDbRow, offsetMinutes: number): ReportScheduleRow {
  const cadence: ScheduleCadence = {
    frequency: (SCHEDULE_FREQUENCIES.some((f) => f.key === row.frequency)
      ? row.frequency
      : 'weekly') as ScheduleFrequency,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    sendHour: row.send_hour,
  };
  return {
    id: row.id,
    name: row.name,
    tab: isReportTab(row.tab) ? row.tab : 'overview',
    tabLabel: REPORT_TABS.find((t) => t.key === row.tab)?.label ?? 'Overview',
    rangeKey: row.range_key,
    // Resolved rather than looked up in a label table, so the period named here
    // is produced by the same function that will name it in the email.
    rangeLabel: resolveRange({ key: row.range_key }, offsetMinutes).label,
    recipients: row.recipients ?? [],
    isActive: row.is_active,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    cadence: describeCadence(cadence),
    ...cadence,
  };
}

export interface ReportSchedulingView {
  schedules: ReportScheduleRow[];
  deliveries: ReportDeliveryRow[];
  /**
   * False when the platform has no email provider. A schedule still saves — it
   * simply will not send — and the UI says so rather than pretending.
   */
  emailConfigured: boolean;
  /** The company's own timezone, or null when it never set one (then: UTC). */
  timeZone: string | null;
}

/**
 * Everything the Scheduled tab renders.
 *
 * The email-provider check goes through `getPlatformEmailSettings()` — the same
 * function `sendEmail()` itself consults — rather than reading the settings
 * rows directly. A second reading of "is email set up" would eventually
 * disagree with the sender, and the screen would promise a delivery that never
 * happens, or warn about one that works fine.
 */
export async function getReportScheduling(): Promise<ReportSchedulingView> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const core = (await getCompanyCoreRow()) as { timezone?: string | null } | null;
  const timeZone = core?.timezone || null;
  const offsetMinutes = timeZone ? zoneOffsetMinutes(new Date(), timeZone) : 0;

  const [scheduleRes, deliveryRes, emailSettings] = await Promise.all([
    sb
      .from('report_schedules')
      .select(
        'id,company_id,name,tab,range_key,frequency,day_of_week,day_of_month,send_hour,recipients,is_active,last_run_at,next_run_at',
      )
      .eq('company_id', companyId) // the isolation boundary — the service client bypasses RLS
      .order('created_at', { ascending: false })
      .limit(LIMITS.rules),
    sb
      .from('report_deliveries')
      .select('id,schedule_id,schedule_name,tab,range_label,status,reason,recipients,created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(25),
    getPlatformEmailSettings(),
  ]);

  const deliveries: ReportDeliveryRow[] = rows<{
    id: number | string;
    schedule_id: string | null;
    schedule_name: string | null;
    tab: string | null;
    range_label: string | null;
    status: string;
    reason: string | null;
    recipients: string[] | null;
    created_at: string;
  }>(deliveryRes).map((d) => ({
    id: String(d.id),
    scheduleId: d.schedule_id,
    scheduleName: d.schedule_name ?? 'Deleted schedule',
    tabLabel: REPORT_TABS.find((t) => t.key === d.tab)?.label ?? 'Overview',
    rangeLabel: d.range_label ?? '—',
    status: d.status === 'sent' || d.status === 'failed' ? d.status : 'skipped',
    reason: d.reason,
    reasonLabel: d.reason ? (DELIVERY_REASONS[d.reason] ?? d.reason) : null,
    recipients: d.recipients ?? [],
    createdAt: d.created_at,
  }));

  return {
    schedules: rows<ScheduleDbRow>(scheduleRes).map((r) => toScheduleRow(r, offsetMinutes)),
    deliveries,
    emailConfigured: Boolean(emailSettings.enabled && emailSettings.fromEmail),
    timeZone,
  };
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

/** Minimal HTML escaping. Every value below is customer-controlled text. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface EmailLine {
  label: string;
  value: string;
  hint?: string;
}

const pct = (n: number) => `${n}%`;
const orDash = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);

/**
 * The numbers for one tab, as label/value lines.
 *
 * Deliberately built from the SAME readers the page and the CSV export use. A
 * second set of queries would be a second definition of every metric, and the
 * first time one drifted the Monday email and the screen would disagree with no
 * way to tell which was right. It also means one tab costs one tab's worth of
 * round trips — the email does not fetch all five.
 */
async function reportLines(
  companyId: string,
  tab: ReportTab,
  range: ReportRange,
): Promise<EmailLine[]> {
  if (tab === 'team') {
    const r = await buildTeamReport(companyId, range);
    return [
      { label: 'Active teammates', value: String(r.totals.agentsActive) },
      { label: 'Conversations handled', value: String(r.totals.conversationsHandled) },
      { label: 'Replies sent', value: String(r.totals.messagesSent) },
      {
        label: 'Median first reply',
        value: orDash(r.totals.medianFirstResponseMinutes, ' min'),
        hint: r.slaEventsUsed ? 'From the SLA clock' : 'From the message timeline',
      },
      { label: 'Unassigned and open now', value: String(r.totals.unassignedOpen) },
      ...r.agents
        .filter((a) => a.conversations > 0)
        .slice(0, 5)
        .map((a) => ({
          label: a.name,
          value: `${a.conversations} conversations`,
          hint: `${a.messagesSent} replies · CSAT ${orDash(a.csatAverage, ' / 5')}`,
        })),
    ];
  }

  if (tab === 'customers') {
    const r = await buildCustomersReport(companyId, range);
    return [
      ...r.funnel.map((s) => ({
        label: s.label,
        value: String(s.count),
        hint: `${s.ofStart}% of chats`,
      })),
      { label: 'Returning visitors', value: pct(r.visitors.returningRate) },
      {
        label: 'Appointments booked',
        value: String(r.appointments.booked),
        hint: `${r.appointments.completed} completed, ${r.appointments.noShow} no-shows`,
      },
      ...r.topCustomers.slice(0, 5).map((c) => ({
        label: c.name,
        value: `${c.currency} ${c.value.toFixed(2)}`,
        hint: `${c.orders} order${c.orders === 1 ? '' : 's'}`,
      })),
    ];
  }

  if (tab === 'assistant') {
    const r = await buildAssistantReport(companyId, range);
    return [
      { label: 'Conversations', value: String(r.conversations) },
      {
        label: 'Sorted without a person',
        value: pct(r.containmentRate),
        hint: `${r.containedConversations} of ${r.conversations}`,
      },
      { label: 'CSAT — AI only', value: orDash(r.csat.aiOnly.average, ' / 5') },
      { label: 'CSAT — human helped', value: orDash(r.csat.humanTouched.average, ' / 5') },
      ...(r.qualityLoggingActive
        ? r.unanswered.slice(0, 5).map((q) => ({
            label: `Could not answer: ${q.question}`,
            value: `${q.count}x`,
          }))
        : [
            {
              label: 'Questions it could not answer',
              value: '—',
              hint: 'Answer quality logging recorded nothing in this period.',
            },
          ]),
    ];
  }

  if (tab === 'sales') {
    const r = await buildSalesReport(companyId, range);
    return [
      {
        label: 'Orders',
        value: String(r.orders.total),
        hint: `${r.orders.fromChat} started in chat`,
      },
      ...r.revenueByCurrency.map((m) => ({
        label: `Order value (${m.currency})`,
        value: m.total.toFixed(2),
        hint: `${m.paid.toFixed(2)} paid`,
      })),
      {
        label: 'Carts abandoned',
        value: String(r.carts.abandoned),
        hint: r.carts.detectorActive
          ? `${r.carts.recovered} recovered (${r.carts.recoveryRate}%)`
          : 'Cart abandonment detection is switched off, so this is not a real zero.',
      },
      {
        label: 'Broadcasts',
        value: String(r.broadcasts.campaigns),
        hint: `${r.broadcasts.recipients} recipients, ${r.broadcasts.failed} failed`,
      },
    ];
  }

  const r = await buildReportsSnapshot(companyId, range);
  return [
    {
      label: 'Conversations',
      value: String(r.totals.conversations),
      hint: `${r.totals.messages} messages`,
    },
    {
      label: 'Handled by AI',
      value: pct(r.totals.automationRate),
      hint: `${r.totals.escalated} needed a person`,
    },
    { label: 'Leads captured', value: String(r.totals.leads) },
    {
      label: 'CSAT',
      value: orDash(r.totals.csatAverage, ' / 5'),
      hint: `${r.totals.csatResponses} ratings`,
    },
    ...r.channels.slice(0, 5).map((c) => ({
      label: c.label,
      value: `${c.conversations} conversations`,
      hint: `${c.automationRate}% handled by AI · ${c.leads} leads`,
    })),
  ];
}

export interface ScheduledReportEmail {
  subject: string;
  html: string;
}

/**
 * Build the email for one schedule. Plain tables and inline styles, because
 * that is all a mail client can be relied on to render.
 */
export async function buildScheduledReportEmail(
  companyId: string,
  companyName: string,
  name: string,
  tab: ReportTab,
  range: ReportRange,
): Promise<ScheduledReportEmail> {
  const lines = await reportLines(companyId, tab, range);
  const tabLabel = REPORT_TABS.find((t) => t.key === tab)?.label ?? 'Overview';
  const link = `${env.NEXT_PUBLIC_APP_URL}/company/reports?tab=${encodeURIComponent(tab)}&range=${encodeURIComponent(range.key)}`;

  const body = lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;color:#4b5563;font-size:14px">
          ${esc(l.label)}
          ${l.hint ? `<br/><span style="color:#9ca3af;font-size:12px">${esc(l.hint)}</span>` : ''}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-size:15px;font-weight:600;white-space:nowrap">
          ${esc(l.value)}
        </td>
      </tr>`,
    )
    .join('');

  return {
    subject: `${name} — ${range.label}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111827">
      <h2 style="margin:0 0 4px">${esc(name)}</h2>
      <p style="color:#6b7280;margin:0 0 16px;font-size:13px">
        ${esc(companyName)} · ${esc(tabLabel)} · ${esc(range.label)}
      </p>
      <table style="width:100%;border-collapse:collapse">${body}</table>
      <p style="margin-top:20px">
        <a href="${esc(link)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Open the full report</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">
        You are receiving this because someone at ${esc(companyName)} scheduled it. It can be turned off under Reports, Scheduled.
      </p>
    </div>`,
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface DeliveryOutcome {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  /** In words, so a caller can put it straight in front of the person. */
  message: string;
  recipients: string[];
}

export interface SendableSchedule extends ScheduleCadence {
  id: string;
  companyId: string;
  name: string;
  tab: ReportTab;
  rangeKey: string;
  recipients: string[];
}

/**
 * Build one scheduled report, email it, and write down what happened.
 *
 * NOTHING HERE THROWS ON A FAILED SEND. A schedule that cannot deliver must
 * still leave a row saying why — that row is the entire reason
 * `report_deliveries` exists — and a cron sweep must carry on to the next
 * company rather than stopping at the first misconfigured one.
 *
 * `emailConfigured` is passed in rather than read here so a sweep over fifty
 * schedules asks the platform settings once instead of fifty times.
 */
export async function deliverScheduledReport(
  schedule: SendableSchedule,
  context: { companyName: string; offsetMinutes: number; emailConfigured: boolean },
): Promise<DeliveryOutcome> {
  const sb = createSupabaseServiceClient();
  const range = resolveRange({ key: schedule.rangeKey }, context.offsetMinutes);
  const recipients = schedule.recipients.filter(Boolean);

  const record = async (outcome: DeliveryOutcome): Promise<DeliveryOutcome> => {
    const { error } = await sb.from('report_deliveries').insert({
      company_id: schedule.companyId,
      schedule_id: schedule.id,
      schedule_name: schedule.name,
      tab: schedule.tab,
      range_label: range.label,
      period_start: range.since,
      period_end: range.until,
      status: outcome.status,
      reason: outcome.reason ?? null,
      recipients: outcome.recipients,
    });
    if (error) {
      logger.error('Could not record a report delivery', {
        scheduleId: schedule.id,
        error: error.message,
      });
    }
    return outcome;
  };

  if (recipients.length === 0) {
    return record({
      status: 'skipped',
      reason: 'no_recipients',
      message: DELIVERY_REASONS.no_recipients ?? 'There was nobody to send to.',
      recipients: [],
    });
  }

  // The report is built even when email is switched off, so a misconfigured
  // platform still proves the report itself works and the delivery row names
  // the one thing that is actually missing.
  let email: ScheduledReportEmail;
  try {
    email = await buildScheduledReportEmail(
      schedule.companyId,
      context.companyName,
      schedule.name,
      schedule.tab,
      range,
    );
  } catch (err) {
    logger.error('Scheduled report could not be built', {
      scheduleId: schedule.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return record({
      status: 'failed',
      reason: 'report_failed',
      message: DELIVERY_REASONS.report_failed ?? 'The report could not be built.',
      recipients,
    });
  }

  if (!context.emailConfigured) {
    return record({
      status: 'skipped',
      reason: 'email_not_configured',
      message: DELIVERY_REASONS.email_not_configured ?? 'Email is not configured.',
      recipients,
    });
  }

  // One message per recipient rather than one with everybody in the To line:
  // these are separate businesses' accountants and franchisees as often as
  // colleagues, and a shared header hands each of them the others' addresses.
  const delivered: string[] = [];
  for (const to of recipients) {
    const res = await sendEmail({ to, subject: email.subject, html: email.html });
    if (res.sent) delivered.push(to);
  }

  if (delivered.length === 0) {
    return record({
      status: 'failed',
      reason: 'send_rejected',
      message: DELIVERY_REASONS.send_rejected ?? 'The email provider rejected the message.',
      recipients,
    });
  }

  return record({
    status: 'sent',
    message: `Sent to ${delivered.length} recipient${delivered.length === 1 ? '' : 's'}.`,
    recipients: delivered,
  });
}

/**
 * The company name and timezone offset a send needs, for a company id that did
 * NOT come from a session.
 *
 * Used by the cron, which takes the id off the schedule row it is processing.
 * Kept separate from `getCompanyCoreRow()` deliberately: that one reads the
 * SESSION's company and would be wrong here in the most dangerous way possible.
 */
export async function getCompanySendContext(
  companyId: string,
): Promise<{ companyName: string; offsetMinutes: number }> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('companies')
    .select('name,timezone')
    .eq('id', companyId)
    .maybeSingle();
  const row = (data ?? {}) as { name?: string; timezone?: string | null };
  const timeZone = row.timezone || null;
  return {
    companyName: row.name ?? 'Your company',
    offsetMinutes: timeZone ? zoneOffsetMinutes(new Date(), timeZone) : 0,
  };
}
