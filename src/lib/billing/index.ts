import { createSupabaseServiceClient } from '@/lib/db/server';
import { PlanLimitError } from '@/lib/errors';

/**
 * Billing & plan enforcement (Module 19). Super-admin overrides on the
 * subscription (free_until, custom limits, suspended) take precedence over the
 * Stripe-derived plan.
 */
export type LimitedAction =
  | 'ai_message'
  | 'create_bot'
  | 'create_agent'
  | 'create_integration'
  | 'place_order'
  | 'ingest';

export interface PlanState {
  plan: string | null;
  status: string;
  freeUntil: string | null;
  messageLimit: number | null;
  botLimit: number | null;
  agentLimit: number | null;
  integrationLimit: number | null;
  /** Stripe's billing period, when a webhook has written one. */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

/** The period a monthly reply allowance is counted over. End is exclusive. */
export interface AllowanceWindow {
  start: string;
  end: string;
  /** Which of the two rules produced it — surfaced for support, not for logic. */
  source: 'subscription' | 'calendar';
}

export interface ReplyGrantRow {
  id: string;
  replyCount: number;
  reason: string;
  grantType: string;
  expiresAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
  /**
   * How many of `replyCount` count toward the CURRENT window. Equal to
   * `replyCount` for a grant made in this window; for one carried over from an
   * earlier window it is what is left of the pool. See `applyGrantWindow`.
   */
  effectiveReplies: number;
}

export interface ReplyAllowanceUsage {
  used: number;
  monthlyAllowance: number | null;
  extraReplies: number;
  totalAvailable: number | null;
  remaining: number | null;
  resetAt: string;
  window: AllowanceWindow;
  grants: ReplyGrantRow[];
}

export function currentMonthStartIso(): string {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

export function currentMonthEndIso(): string {
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + 1, 1);
  end.setUTCHours(0, 0, 0, 0);
  return end.toISOString();
}

export async function getSubscription(companyId: string): Promise<PlanState | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('subscriptions')
    .select(
      'plan, status, free_until, message_limit, bot_limit, agent_limit, integration_limit, current_period_start, current_period_end',
    )
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    plan: (d.plan as string) ?? null,
    status: d.status as string,
    freeUntil: (d.free_until as string) ?? null,
    messageLimit: (d.message_limit as number) ?? null,
    botLimit: (d.bot_limit as number) ?? null,
    agentLimit: (d.agent_limit as number) ?? null,
    integrationLimit: (d.integration_limit as number) ?? null,
    currentPeriodStart: (d.current_period_start as string) ?? null,
    currentPeriodEnd: (d.current_period_end as string) ?? null,
  };
}

/**
 * The window this company's reply allowance is measured over.
 *
 * The calendar month was wrong for everybody who did not subscribe on the 1st.
 * A customer who started on the 25th got a whole month's replies for six days,
 * then a fresh whole month on the 1st — one subscription, two allowances, and
 * the more expensive the plan the more it gave away. Stripe already tells us the
 * real period: `current_period_start` / `current_period_end` are written by the
 * subscription webhook, so when they are there they decide the window.
 *
 * The calendar fallback is not a nicety. Comped companies, hand-provisioned
 * accounts and anything created before Stripe was wired in have no period at
 * all, and they still need an allowance that resets. A period that has already
 * ENDED falls back too: a missed webhook would otherwise freeze the window in
 * the past, counting usage against a period nobody is in and never resetting —
 * the failure mode where a paying customer is locked out until an operator
 * notices, which is the worst direction to be wrong in.
 */
export function allowanceWindowFor(sub: PlanState | null): AllowanceWindow {
  const start = sub?.currentPeriodStart ? Date.parse(sub.currentPeriodStart) : Number.NaN;
  const end = sub?.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : Number.NaN;
  const now = Date.now();
  if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end) {
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      source: 'subscription',
    };
  }
  return { start: currentMonthStartIso(), end: currentMonthEndIso(), source: 'calendar' };
}

/**
 * @deprecated Use `companyAllowsPremiumModel` from `@/lib/ai/model-policy`.
 *
 * This hardcoded a plan list, so it could not see the per-company grants an
 * operator makes through `subscriptions.feature_overrides` — a Starter customer
 * explicitly given the premium model was refused it here anyway. It now
 * delegates rather than being deleted, so that a caller added later cannot
 * quietly resurrect the list.
 */
export async function planAllowsAdvancedModel(companyId: string): Promise<boolean> {
  const { companyAllowsPremiumModel } = await import('@/lib/ai/model-policy');
  return companyAllowsPremiumModel(companyId);
}

/** AI chat replies logged for this company between two instants (end exclusive). */
async function countChatReplies(
  companyId: string,
  sinceIso: string,
  untilIso?: string,
): Promise<number> {
  const sb = createSupabaseServiceClient();
  const base = sb
    .from('ai_usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('operation_type', 'chat')
    .gte('created_at', sinceIso);
  const { count } = untilIso ? await base.lt('created_at', untilIso) : await base;
  return count ?? 0;
}

/**
 * Messages (AI chat operations) used in the current calendar month.
 *
 * Deliberately still the calendar month: this is the platform-wide usage figure
 * the super-admin screens total across companies, and totalling numbers measured
 * over a different window per company would mean nothing. The figure a CUSTOMER
 * is billed against is `getReplyAllowanceUsage`, which uses their own window.
 */
export async function getMonthlyMessageCount(companyId: string): Promise<number> {
  return countChatReplies(companyId, currentMonthStartIso());
}

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/** Shift an instant by whole UTC months, clamping the day (31 Mar -1 => 28 Feb). */
function addUtcMonths(iso: string, months: number): string {
  const source = new Date(iso);
  const day = source.getUTCDate();
  const shifted = new Date(source);
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted.toISOString();
}

/**
 * How many whole allowance windows ago a grant was made, and when that window
 * began. Walks back a window at a time from the current one, which is right for
 * both window rules: a calendar month steps to the 1st, a Stripe period steps to
 * the same day of the previous month. 240 is a loop bound, not a policy.
 */
function windowOfGrant(createdAtIso: string, windowStartIso: string): {
  windows: number;
  start: string;
} {
  const created = Date.parse(createdAtIso);
  let start = windowStartIso;
  let windows = 0;
  while (windows < 240 && Date.parse(start) > created) {
    start = addUtcMonths(start, -1);
    windows += 1;
  }
  return { windows, start };
}

/** The window a grant is being measured against, and the allowance it tops up. */
export interface GrantContext {
  window: AllowanceWindow;
  monthlyAllowance: number | null;
}

/**
 * Decide how much of each grant this window may spend.
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * Every unexpired grant was added to the allowance in full, every month, while
 * `used` reset at the start of each window. So a support grant of 1,000 replies
 * with a three-month expiry — which the operator's own form offers, and which
 * reads as "you have three months to use these" — handed out 1,000 replies in
 * month one, another 1,000 in month two, and another in month three. Three
 * thousand replies granted, one thousand approved, and nothing on any screen
 * said so.
 *
 * THE SEMANTICS
 * -------------
 * A grant is a POOL, not a monthly repeat. It belongs to the window it was made
 * in, which is the whole story for the common grant: the operator form defaults
 * `expires_at` to the end of the current month, so almost every grant is
 * single-window and this function returns `replyCount` unchanged.
 *
 * An explicit longer expiry is the operator saying the pool should outlive that
 * window, so the grant keeps counting until it expires — but only for what is
 * LEFT of it. What earlier windows already drew is the usage those windows ran
 * up beyond their own plan allowance, which is exactly what the grant was there
 * to cover: everything below the plan allowance was paid for by the plan.
 *
 *   drawn = max(0, replies used since the oldest carried grant's window began
 *                  - the plan allowance for each of those whole windows)
 *
 * and `drawn` is taken off the carried grants oldest first, so the one closest
 * to expiring is spent first. The measurement stops at the start of the current
 * window on purpose: this window's usage is already counted in `used` and
 * subtracted there, and subtracting it twice would charge every reply against
 * the allowance and the pool at once.
 *
 * WHY NOT A CONSUMED COLUMN
 * -------------------------
 * A `consumed_replies` column on the grant would be exact, but it has to be
 * decremented on the reply path, inside the request that answers a customer —
 * one more write, on the hot path, that can fail after the reply has been sent.
 * Deriving it from `ai_usage_logs`, which already records every reply and is
 * already indexed by (company_id, created_at), costs one COUNT and only when a
 * carried grant actually exists, which for a default grant is never.
 *
 * An unlimited plan (`monthlyAllowance == null`) skips all of it: there is no
 * allowance to exceed, so nothing can draw on a pool and the grants are
 * decoration on the billing page.
 */
async function applyGrantWindow(
  companyId: string,
  rows: Omit<ReplyGrantRow, 'effectiveReplies'>[],
  ctx: GrantContext,
): Promise<ReplyGrantRow[]> {
  const dated = rows.map((row) => ({ row, ...windowOfGrant(row.createdAt, ctx.window.start) }));
  const carried = dated.filter((entry) => entry.windows > 0);
  if (carried.length === 0 || ctx.monthlyAllowance == null) {
    return dated.map((entry) => ({ ...entry.row, effectiveReplies: entry.row.replyCount }));
  }

  const oldest = carried.reduce((a, b) => (a.start <= b.start ? a : b));
  const usedBefore = await countChatReplies(companyId, oldest.start, ctx.window.start);
  let drawn = Math.max(0, usedBefore - ctx.monthlyAllowance * oldest.windows);

  const left = new Map<string, number>();
  for (const entry of [...carried].sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt))) {
    const spent = Math.min(entry.row.replyCount, drawn);
    drawn -= spent;
    left.set(entry.row.id, entry.row.replyCount - spent);
  }

  return dated.map((entry) => ({
    ...entry.row,
    effectiveReplies: left.get(entry.row.id) ?? entry.row.replyCount,
  }));
}

/**
 * Unexpired grants for this company, each with the share the current window may
 * spend. Pass the window when the caller already has it, so one page does not
 * read the subscription twice.
 */
export async function listActiveReplyGrants(
  companyId: string,
  context?: GrantContext,
): Promise<ReplyGrantRow[]> {
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data } = await sb
    .from('company_reply_grants')
    .select('id,reply_count,reason,grant_type,expires_at,created_at, users(email)')
    .eq('company_id', companyId)
    .or(`expires_at.is.null,expires_at.gte.${now}`)
    .order('created_at', { ascending: false });

  const rows = (data ?? []).map((grant) => {
    const row = grant as Record<string, unknown>;
    const user = one(row.users as { email?: string } | { email?: string }[] | null);
    return {
      id: row.id as string,
      replyCount: Number(row.reply_count ?? 0),
      reason: (row.reason as string) ?? 'Manual allowance adjustment',
      grantType: (row.grant_type as string) ?? 'manual',
      expiresAt: (row.expires_at as string) ?? null,
      createdAt: row.created_at as string,
      createdByEmail: user?.email ?? null,
    };
  });
  if (rows.length === 0) return [];

  const ctx =
    context ??
    (await (async (): Promise<GrantContext> => {
      const sub = await getSubscription(companyId);
      return { window: allowanceWindowFor(sub), monthlyAllowance: sub?.messageLimit ?? null };
    })());
  return applyGrantWindow(companyId, rows, ctx);
}

export async function getReplyAllowanceUsage(companyId: string): Promise<ReplyAllowanceUsage> {
  const sub = await getSubscription(companyId);
  const period = allowanceWindowFor(sub);
  const monthlyAllowance = sub?.messageLimit ?? null;
  const [used, grants] = await Promise.all([
    countChatReplies(companyId, period.start, period.end),
    listActiveReplyGrants(companyId, { window: period, monthlyAllowance }),
  ]);
  // Only what this window may spend counts. A grant carried over from an
  // earlier window that has already been used up shows on the billing page with
  // nothing left rather than silently topping the customer up again.
  const extraReplies = grants.reduce((sum, grant) => sum + grant.effectiveReplies, 0);
  const totalAvailable = monthlyAllowance == null ? null : monthlyAllowance + extraReplies;
  return {
    used,
    monthlyAllowance,
    extraReplies,
    totalAvailable,
    remaining: totalAvailable == null ? null : Math.max(0, totalAvailable - used),
    // The date the billing page renders as "resets" has to be the end of the
    // window `used` was counted over, or the page tells the customer their
    // replies come back on a day they do not.
    resetAt: period.end,
    window: period,
    grants,
  };
}

/** True if the company may still send an AI message (under limit + not suspended). */
export async function withinMessageQuota(companyId: string): Promise<boolean> {
  const sub = await getSubscription(companyId);
  if (!sub) return true;
  if (sub.status === 'suspended') return false;
  if (sub.messageLimit == null) return true;
  const usage = await getReplyAllowanceUsage(companyId);
  return usage.totalAvailable == null || usage.used < usage.totalAvailable;
}

/** Throwing guard for dashboard create actions. */
export async function assertWithinPlan(companyId: string, action: LimitedAction): Promise<void> {
  const sub = await getSubscription(companyId);
  if (!sub) return;
  if (sub.status === 'suspended') throw new PlanLimitError('This account is suspended.');

  const sb = createSupabaseServiceClient();
  const countWhere = async (table: string) => {
    const { count } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    return count ?? 0;
  };

  if (action === 'create_bot' && sub.botLimit != null && (await countWhere('bots')) >= sub.botLimit) {
    throw new PlanLimitError(`Your plan allows up to ${sub.botLimit} assistant(s).`);
  }
  if (action === 'create_integration' && sub.integrationLimit != null) {
    // Only live connections consume the limit. Disconnecting sets
    // `status = 'disconnected'` (see `disconnectIntegrationAction`) and nothing
    // ever deletes the row, so counting every row meant a customer who
    // connected Shopify, disconnected it, and tried WooCommerce instead was
    // permanently at their limit with no way out that did not involve support
    // running SQL. `'error'` still counts: that is a connection this company
    // has, currently broken, and repairing it is a button rather than a new
    // integration.
    const { count } = await sb
      .from('integration_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .neq('status', 'disconnected');
    if ((count ?? 0) >= sub.integrationLimit) {
      throw new PlanLimitError(`Your plan allows up to ${sub.integrationLimit} integration(s).`);
    }
  }
  if (action === 'create_agent' && sub.agentLimit != null) {
    const { count } = await sb
      .from('company_users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('role', 'agent');
    const { count: pending } = await sb
      .from('agent_invites')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    if ((count ?? 0) + (pending ?? 0) >= sub.agentLimit) {
      throw new PlanLimitError(`Your plan allows up to ${sub.agentLimit} agent(s).`);
    }
  }
}
