import { tokenize } from '@/lib/flows/nlu';

/**
 * Pure aggregation maths for the reports surface.
 *
 * Deliberately free of database, React and Next imports: every function here
 * takes plain rows and returns plain numbers, which is what makes
 * `scripts/test-reports.mjs` able to exercise the arithmetic against fixtures
 * with no Supabase in the process. `reports-data.ts` does the fetching and
 * calls into this file; nothing here fetches anything.
 */

// ---------------------------------------------------------------------------
// Small shared numerics
// ---------------------------------------------------------------------------

/**
 * Whole-number percentage of `part` in `total`.
 *
 * A zero denominator is 0%, not NaN and not "100% of nothing": every funnel and
 * rate on this page can legitimately start from an empty period, and a NaN
 * escaping into JSX renders as the literal text "NaN%".
 */
export function percentage(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** One decimal place, or null when there is nothing to average. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Median of a numeric list — the middle value for an odd count, the mean of the
 * two middle values for an even one.
 *
 * Response times are the reason this is a median and not a mean: one
 * conversation answered the next morning drags an average past the point of
 * being about anything, while the median still describes a typical shift.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

/** Share of conversations the assistant finished on its own, as a percentage. */
export function containmentRate(total: number, escalated: number): number {
  if (total <= 0) return 0;
  const contained = Math.max(0, total - escalated);
  return percentage(contained, total);
}

// ---------------------------------------------------------------------------
// Busiest hours (7 × 24)
// ---------------------------------------------------------------------------

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface HourHeatmap {
  /** `grid[day][hour]`, day 0 = Sunday, hour 0 = midnight. */
  grid: number[][];
  /** Busiest single cell, floored at 1 so callers can divide by it safely. */
  max: number;
  total: number;
  /** The busiest cell, or null when nothing landed in the grid. */
  peak: { day: number; hour: number; count: number } | null;
}

function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

/**
 * Bucket timestamps into a 7-day × 24-hour grid.
 *
 * Buckets are read in UTC after shifting by `offsetMinutes`, rather than with
 * `getDay()`/`getHours()`: those read the *server's* zone, so the same
 * conversation would land in a different cell depending on which region the
 * page rendered in. Passing the company's offset keeps "busiest hour" in the
 * shop's own clock, and the shift is applied before the day is read so a late
 * evening rolling past midnight moves to the next day, not just the next hour.
 */
export function buildHourHeatmap(
  timestamps: Array<string | number | Date | null | undefined>,
  offsetMinutes = 0,
): HourHeatmap {
  const grid = emptyGrid();
  let total = 0;

  for (const raw of timestamps) {
    if (raw === null || raw === undefined || raw === '') continue;
    const parsed = raw instanceof Date ? raw : new Date(raw);
    const ms = parsed.getTime();
    if (!Number.isFinite(ms)) continue;
    const shifted = new Date(ms + offsetMinutes * 60_000);
    const day = shifted.getUTCDay();
    const hour = shifted.getUTCHours();
    grid[day]![hour]! += 1;
    total += 1;
  }

  let peak: HourHeatmap['peak'] = null;
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const count = grid[day]![hour]!;
      if (count > 0 && (peak === null || count > peak.count)) peak = { day, hour, count };
    }
  }

  return { grid, max: Math.max(peak?.count ?? 0, 1), total, peak };
}

/** "Tue 14:00–15:00" for a heatmap cell. */
export function describeHeatmapCell(day: number, hour: number): string {
  const label = DAY_LABELS[day] ?? '?';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${label} ${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;
}

// ---------------------------------------------------------------------------
// Funnels
// ---------------------------------------------------------------------------

export interface FunnelInput {
  key: string;
  label: string;
  count: number;
  /** One line explaining where the number comes from. */
  hint?: string;
}

export interface FunnelStage extends FunnelInput {
  /** Percentage of the first stage. */
  ofStart: number;
  /** Percentage of the stage immediately above. */
  ofPrevious: number;
}

/**
 * Turn raw stage counts into a funnel with both conversion percentages.
 *
 * `ofPrevious` is the number a shop owner acts on ("we lose two thirds right
 * here"); `ofStart` is the one they quote. Both are 0 when the stage above is
 * empty rather than dividing by zero.
 */
export function buildFunnel(stages: FunnelInput[]): FunnelStage[] {
  const start = stages[0]?.count ?? 0;
  return stages.map((stage, index) => ({
    ...stage,
    ofStart: index === 0 ? (start > 0 ? 100 : 0) : percentage(stage.count, start),
    ofPrevious: index === 0 ? (start > 0 ? 100 : 0) : percentage(stage.count, stages[index - 1]!.count),
  }));
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface TopicCount {
  term: string;
  /** Number of distinct messages the term appeared in. */
  count: number;
  /** Share of the messages considered. */
  share: number;
}

/**
 * Keyword clusters over visitor messages.
 *
 * Counts each term once per message rather than once per occurrence, so someone
 * repeating "refund refund refund" in one line does not outvote twenty separate
 * people asking about delivery. Stopwords come from the flow NLU tokenizer —
 * imported, not copied, so the two never drift into disagreeing about what a
 * meaningful word is.
 */
export function topTopics(texts: Array<string | null | undefined>, limit = 12): TopicCount[] {
  const counts = new Map<string, number>();
  let considered = 0;

  for (const text of texts) {
    if (!text) continue;
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    considered += 1;
    for (const token of new Set(tokens)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count, share: percentage(count, considered) }));
}

/**
 * Collapse near-identical questions so the "unanswered" list is a to-do list
 * rather than a transcript. Whitespace and trailing punctuation only — the
 * first spelling seen is kept for display.
 */
export function groupQuestions(
  questions: Array<string | null | undefined>,
  limit = 15,
): Array<{ question: string; count: number }> {
  const groups = new Map<string, { question: string; count: number }>();
  for (const raw of questions) {
    if (!raw) continue;
    const question = raw.trim();
    if (!question) continue;
    const key = question.toLowerCase().replace(/\s+/g, ' ').replace(/[?!.\s]+$/, '');
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { question, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

// ---------------------------------------------------------------------------
// First contact resolution
// ---------------------------------------------------------------------------

export interface FcrConversation {
  id: string;
  visitorId: string | null;
  startedAt: string;
  status: string | null;
}

export interface FcrResult {
  /** Conversations that ended in the period — the denominator. */
  closed: number;
  resolvedFirstContact: number;
  /** Null when nothing closed in the period, so the page can say so. */
  rate: number | null;
}

/** A repeat visit inside this window means the first contact did not resolve it. */
const FOLLOW_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * First contact resolution: a conversation that closed, never reached a human,
 * and was not followed by the same visitor coming back within a day.
 *
 * The follow-up test is what stops this from being a restatement of the
 * automation rate. A bot that confidently answers wrong closes the chat and
 * scores 100% without it; the customer starting again twenty minutes later is
 * the signal that the first contact did not actually resolve anything.
 */
export function firstContactResolution(
  conversations: FcrConversation[],
  humanTouched: Set<string>,
): FcrResult {
  const byVisitor = new Map<string, number[]>();
  for (const c of conversations) {
    if (!c.visitorId) continue;
    const at = new Date(c.startedAt).getTime();
    if (!Number.isFinite(at)) continue;
    const list = byVisitor.get(c.visitorId);
    if (list) list.push(at);
    else byVisitor.set(c.visitorId, [at]);
  }

  let closed = 0;
  let resolved = 0;
  for (const c of conversations) {
    if (c.status !== 'closed') continue;
    closed += 1;
    if (humanTouched.has(c.id)) continue;
    const at = new Date(c.startedAt).getTime();
    const siblings = c.visitorId ? (byVisitor.get(c.visitorId) ?? []) : [];
    const cameBack = siblings.some((other) => other > at && other - at <= FOLLOW_UP_WINDOW_MS);
    if (!cameBack) resolved += 1;
  }

  return { closed, resolvedFirstContact: resolved, rate: closed === 0 ? null : percentage(resolved, closed) };
}

// ---------------------------------------------------------------------------
// New vs returning
// ---------------------------------------------------------------------------

export interface VisitorSplit {
  identified: number;
  anonymous: number;
  newVisitors: number;
  returningVisitors: number;
  returningRate: number;
}

/**
 * Split visitors by whether they came back inside the selected window.
 *
 * Scoped to the window on purpose: deciding "returning" against all history
 * would mean a lookback over every conversation the company has ever had, which
 * is exactly the unbounded query this page must not run. The label in the UI
 * says "in this period" so the number is not read as lifetime loyalty.
 */
export function splitVisitors(visitorIds: Array<string | null | undefined>): VisitorSplit {
  const counts = new Map<string, number>();
  let anonymous = 0;
  for (const id of visitorIds) {
    if (!id) {
      anonymous += 1;
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let newVisitors = 0;
  let returningVisitors = 0;
  for (const count of counts.values()) {
    if (count > 1) returningVisitors += 1;
    else newVisitors += 1;
  }
  const identified = counts.size;
  return {
    identified,
    anonymous,
    newVisitors,
    returningVisitors,
    returningRate: percentage(returningVisitors, identified),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Escape one CSV field — always quoted, internal quotes doubled.
 *
 * Quoting unconditionally rather than only when a comma is present is what
 * makes a field like `Yes, "urgent" please` survive: RFC 4180 says a quote
 * inside a quoted field is written twice, and a value containing a comma must
 * be quoted or it silently becomes two columns in the owner's spreadsheet.
 * Line breaks need no extra handling — they are legal inside the quotes.
 */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Header + rows into an RFC 4180 document with CRLF line endings. */
export function toCsv(header: string[], rows: Array<Array<unknown>>): string {
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\r\n');
}
