import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notify';
import {
  currentMonthStartIso,
  getReplyAllowanceUsage,
  getSubscription,
  type ReplyAllowanceUsage,
} from '@/lib/billing';

/**
 * Early warning for the two meters that silence a company's assistant.
 *
 * WHAT WAS MISSING
 * ----------------
 * Three gates run before any widget reply (`src/app/api/chat/route.ts`): the
 * monthly reply allowance, the company's own USD budget cap, and the prepaid
 * credit balance. Two of them are counters that only ever go one way inside a
 * billing window, and when either lands the assistant stops answering EVERY
 * visitor. Nothing told the customer it was coming: no email, no in-app
 * notice, and a billing page whose progress bar looks the same at 5% and 100%.
 * The first thing an owner learned about it was a silent widget — usually from
 * a customer, usually days later.
 *
 * The credit meter used to be the one that bit first, and this module was
 * written against that: Starter shipped £5 of included credit against 500
 * replies that cost the wallet £6.06 to serve, so the wallet emptied around
 * reply 412 and the assistant went silent on a customer who was still paying.
 * `includedCreditGbp` has since been resized from the measured cost per reply
 * (the derivation is in `src/modules/super-admin/plans.ts`) and Starter now
 * carries £7, so the credit gate is no longer a second cap that bites before
 * the allowance.
 *
 * The low-credit warning stays anyway, because the two meters still move
 * independently. `deductAiCreditForUsage` fires on EVERY `logAiUsage` call —
 * ingestion, embeddings, insights, the copilot — and none of those decrement
 * the reply allowance, so a company can still be walked down to an empty wallet
 * with most of its replies unspent. The 15% headroom in the sizing is the only
 * cushion against that, and this is the only thing that says so before it is
 * gone. Auto top-up is not that safety net: it only helps a company that has
 * saved a card.
 *
 * WHY THE COMPANY'S OWN BUDGET CAP IS NOT SWEPT FOR HERE
 * -----------------------------------------------------
 * `isAiBudgetExceeded` is a limit the company sets for itself in
 * /company/ai-controls. Approaching a ceiling you chose is the feature working,
 * not a surprise, and sweeping about it would train owners to ignore these
 * emails. Actually hitting it is a different event — the assistant stopped —
 * and that is raised where it happens, by `notifyReplyGateBlocked` in
 * `@/lib/ai/inbound`, under the shared reason `budget_exceeded`. This module
 * never raises that one; it only has to know the value exists so nothing here
 * ever reuses it.
 */

/**
 * The shared discriminator vocabulary for `over_usage_limit`.
 *
 * This module and `notifyReplyGateBlocked` in `@/lib/ai/inbound` both write
 * that one notification type. As first drafted they deduped on different keys —
 * `data_json.alert` here, `data_json.gate` there — and neither discriminator
 * appeared in the other's rows, so neither read could see the other's work: a
 * company that exhausted its allowance would have been warned from BOTH sides,
 * about four near-identical emails per window where the mechanism was supposed
 * to allow one. That was caught before either writer shipped, so no customer
 * ever received it and no row carries either old key (see `reasonOf`). Teaching
 * a customer to filter these to trash is the failure this whole module exists to
 * avoid, so the two sides share one key, `data_json.reason`, drawn from this
 * list. Adding a value means teaching both writers about it.
 */
export type UsageAlertReason =
  | 'replies_80'
  | 'replies_100'
  | 'credit_low'
  | 'credit_empty'
  | 'budget_exceeded';

/**
 * The subset this module can raise. `budget_exceeded` is the gate's alone (see
 * above), and there is no gate-side equivalent of the two early warnings — a
 * gate only ever fires once the meter has already landed.
 */
export type UsageAlertKey = Exclude<UsageAlertReason, 'budget_exceeded'>;

export interface UsageAlertRun {
  companyId: string;
  /** Alerts actually raised on this run, in the order they were sent. */
  sent: UsageAlertKey[];
}

/**
 * Every alert here is filed under one notification type and distinguished by
 * `data_json.reason`.
 *
 * A new `NotificationType` would have been the tidier model, but each one has
 * to be taught to four other maps that are not part of this change (webhook
 * event names, push routing, the delivery-settings grid, the core-event set),
 * and an unknown type quietly loses its push route. `over_usage_limit` already
 * exists, already routes to /company/billing in `src/lib/push/fanout.ts`, and
 * had no dispatch site at all — this is one of the two callers it was declared
 * for. Both meters are "the thing that stops your assistant replying"; the
 * title says which one.
 *
 * WHICH SIDE WINS WHEN BOTH COULD SPEAK
 * -------------------------------------
 * Two of these reasons can be reached from either side: `replies_100` is the
 * gate's `quota` and `credit_empty` is its `credit`. Because both sides now read
 * and write the same key over the same window, whichever gets there first takes
 * the reason and the other stands down — one email, not two, and no ordering
 * rule to keep in sync between two files.
 *
 * In practice the gate wins whenever a visitor was actually turned away, and
 * that is the right outcome: an allowance can only reach 100% by serving a
 * reply, so the very next inbound message trips the gate within seconds, while
 * this sweep is minutes to hours behind it. The gate's copy is also the more
 * useful one in that situation — it says the assistant has stopped AND that new
 * conversations are being queued for a human, which is what the owner has to act
 * on first.
 *
 * The copy below is not a worse duplicate of it; it is the right copy for the
 * only case the gate cannot cover — a meter that landed with nobody at the door.
 * A company that ran out overnight, or was moved down a plan, has an exhausted
 * allowance and no blocked message to trigger anything, and telling that owner
 * their conversations are going to the inbox would be false: nothing is coming
 * in. So both stay, and the shared key makes them mutually exclusive.
 */
const ALERT_NOTIFICATION_TYPE = 'over_usage_limit' as const;

/** Warn at four fifths of the allowance — enough runway to buy more. */
const REPLY_WARN_RATIO = 0.8;

/** How many recent charges to average when estimating replies left. */
const RATE_SAMPLE_SIZE = 50;

interface AlertDraft {
  key: UsageAlertKey;
  /** Start of the window this alert may be sent at most once in. */
  windowStart: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function money(value: number): string {
  return `£${value.toFixed(2)}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/**
 * The wallet, read straight from the table rather than through
 * `getAiCreditAccess`, because the alert needs `low_balance_threshold` in the
 * same row. That column has been written as 2 since migration 0024 and until
 * now was only ever read on a super-admin screen — it is the figure somebody
 * already decided "low" means, so it decides this too.
 *
 * The service-role client bypasses RLS, so the `company_id` filter IS the
 * tenant boundary. `companyId` comes from a job or a session, never a request
 * body.
 */
async function readWallet(
  companyId: string,
): Promise<{ balance: number; threshold: number } | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('company_credit_accounts')
    .select('balance_amount,low_balance_threshold')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    logger.warn('Usage alerts could not read the credit wallet', {
      companyId,
      module: 'billing.usage-alerts',
      error: error.message,
    });
    return null;
  }
  // No wallet row means credit is not tracked for this company, so the credit
  // gate lets every reply through and there is nothing to warn about.
  if (!data) return null;
  return {
    balance: Number(data.balance_amount ?? 0),
    threshold: Number(data.low_balance_threshold ?? 0),
  };
}

/**
 * What one reply currently costs this company's wallet, averaged over its own
 * recent charges.
 *
 * Measured rather than derived from `MEASURED_COST_PER_REPLY_USD`, because the
 * model a company is served depends on its plan, its overrides and its
 * provider, and resolving all of that here to produce a rounder number would be
 * a worse answer than the ledger's. Returns null when there is nothing to
 * average from, and the message then omits the estimate rather than guessing.
 */
async function recentChargePerReply(companyId: string): Promise<number | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('company_credit_transactions')
    .select('amount')
    .eq('company_id', companyId)
    .eq('type', 'ai_usage')
    .order('created_at', { ascending: false })
    .limit(RATE_SAMPLE_SIZE);
  if (error || !data || data.length === 0) return null;
  const charges = data.map((row) => Math.abs(Number(row.amount ?? 0))).filter((n) => n > 0);
  if (charges.length === 0) return null;
  return charges.reduce((sum, n) => sum + n, 0) / charges.length;
}

/** "about 148 more replies" — or nothing at all when we cannot measure it. */
async function repliesLeftPhrase(companyId: string, balance: number): Promise<string> {
  if (balance <= 0) return '';
  const perReply = await recentChargePerReply(companyId);
  if (perReply == null || perReply <= 0) return '';
  const left = Math.floor(balance / perReply);
  if (left <= 0) return '';
  return ` That is roughly ${left.toLocaleString('en-GB')} more replies at your recent rate.`;
}

/** The reply-allowance alerts due for this window, worst first. */
function replyAlerts(usage: ReplyAllowanceUsage): AlertDraft[] {
  // An unlimited plan has no allowance to cross.
  if (usage.totalAvailable == null) return [];

  const available = usage.totalAvailable;
  // A zero allowance is 100% used the moment it exists — `withinMessageQuota`
  // is already refusing every reply — so guard the division rather than
  // reporting NaN%.
  const ratio = available > 0 ? usage.used / available : 1;
  const data = {
    used: usage.used,
    allowance: available,
    remaining: usage.remaining ?? 0,
    resetsOn: day(usage.resetAt),
    window: usage.window.source,
  };

  if (ratio >= 1) {
    return [
      {
        key: 'replies_100',
        windowStart: usage.window.start,
        title: 'Your assistant has stopped replying — reply allowance used up',
        body:
          `All ${available.toLocaleString('en-GB')} replies in this billing period have been used, ` +
          `so your assistant is no longer answering visitors. It starts again on ${day(usage.resetAt)}. ` +
          'To bring it back sooner, upgrade your plan on the billing page.',
        data,
      },
    ];
  }
  if (ratio >= REPLY_WARN_RATIO) {
    return [
      {
        key: 'replies_80',
        windowStart: usage.window.start,
        title: `You have used ${Math.round(ratio * 100)}% of this period's replies`,
        body:
          `${usage.used.toLocaleString('en-GB')} of ${available.toLocaleString('en-GB')} replies used, ` +
          `${(usage.remaining ?? 0).toLocaleString('en-GB')} left. When they run out your assistant stops ` +
          `answering visitors until ${day(usage.resetAt)}.`,
        data,
      },
    ];
  }
  return [];
}

/** The credit alerts due this month, worst first. */
async function creditAlerts(
  companyId: string,
  wallet: { balance: number; threshold: number },
): Promise<AlertDraft[]> {
  // Credit alerts are measured over the UTC calendar month because that is the
  // window `replenishMonthlyCredit` grants in: one warning per month is one
  // warning per top-up, and the counter resets exactly when the money does.
  const windowStart = currentMonthStartIso();
  const data = { balance: wallet.balance, lowBalanceThreshold: wallet.threshold };

  if (wallet.balance <= 0) {
    return [
      {
        key: 'credit_empty',
        windowStart,
        title: 'Your assistant has stopped replying — AI credit is empty',
        body:
          'Your AI credit balance has reached zero, so your assistant is no longer answering ' +
          'visitors. Topping up on the billing page brings it back immediately.',
        data,
      },
    ];
  }
  if (wallet.threshold > 0 && wallet.balance <= wallet.threshold) {
    return [
      {
        key: 'credit_low',
        windowStart,
        title: 'Your AI credit is running low',
        body:
          `${money(wallet.balance)} of AI credit left.${await repliesLeftPhrase(companyId, wallet.balance)} ` +
          'When it reaches zero your assistant stops answering visitors, whatever reply allowance ' +
          'your plan still has left.',
        data,
      },
    ];
  }
  return [];
}

/**
 * The reason a stored notification records.
 *
 * THERE IS NO LEGACY KEY TO FALL BACK TO — CHECKED, NOT ASSUMED
 * ------------------------------------------------------------
 * This used to also accept `data_json.alert` and `data_json.gate`, described as
 * a transitional path for "rows written before the rename" and justified by the
 * claim that at deploy every company already over a limit would have an
 * in-window row this read would miss. No such row can exist:
 *   - `over_usage_limit` has been a member of `NotificationType` and a route in
 *     the push fan-out since the first commit, and `git log -S` over every ref
 *     finds no site that ever passed it to `notify()` before this change. A type
 *     nobody dispatches writes no rows.
 *   - This module is new in the same change, so its own old key never ran
 *     either, and `notifyReplyGateBlocked` is new in `@/lib/ai/inbound`.
 * So the fallbacks could only ever have matched rows that do not exist, and the
 * comment defending them asserted a deploy-day flood that could not happen.
 * Going forward a `gate`-only row is not producible either: the gate writes
 * `gate` as context but always alongside `reason`, which wins here anyway.
 */
function reasonOf(payload: Record<string, unknown> | undefined): string | null {
  return typeof payload?.reason === 'string' ? payload.reason : null;
}

/**
 * Which of these alerts have already gone out in their own window.
 *
 * DERIVED, NOT REMEMBERED
 * -----------------------
 * The once-per-threshold-per-window property is the whole point of this module,
 * and it is answered by reading the notifications that were sent rather than by
 * keeping a "last alerted" column beside them. A column is a second copy of the
 * same fact and it goes wrong in the ways second copies do: it survives a
 * notification being deleted, it is not restored in step with the rows it
 * describes, and it has to be reset by hand every time a window rolls over —
 * which is precisely the bookkeeping that a `notify()` call failing halfway
 * through would corrupt. The notification row is the evidence the customer was
 * told, so it is the right thing to ask.
 *
 * That rests on an ordering guarantee inside `notify()`: the row is written
 * FIRST, and the email, webhook and push fan-out only run once the write has
 * come back clean. If a later channel throws, the alert still counts as sent and
 * the customer is not emailed the same warning every ten minutes for the rest of
 * the month. That guarantee used to be an assumption — the insert result was
 * discarded, so a rejected write silently emailed anyway and left nothing for
 * this read to find, which is the flood itself. `notify()` now checks it and
 * reports back through `NotifyResult.persisted`, which the loop below believes
 * over its own optimism.
 *
 * The read is bounded by the earliest window in play and the
 * `(company_id, created_at desc)` index from migration 0007 serves it directly.
 */
async function alreadySent(
  companyId: string,
  drafts: AlertDraft[],
): Promise<Set<UsageAlertKey> | null> {
  const earliest = drafts.reduce<string | null>(
    (min, draft) => (min == null || draft.windowStart < min ? draft.windowStart : min),
    null,
  );
  if (earliest == null) return new Set<UsageAlertKey>();

  const { data, error } = await createSupabaseServiceClient()
    .from('notifications')
    .select('data_json,created_at')
    .eq('company_id', companyId)
    .eq('type', ALERT_NOTIFICATION_TYPE)
    .gte('created_at', earliest);

  // A failed read fails CLOSED: not sending is a warning a day late, which the
  // next run fixes. Sending because a query blipped is the same alarming email
  // on every sweep, which teaches the customer to filter these to trash — and
  // the one that matters is the one they then never read.
  if (error) {
    logger.warn('Usage alerts could not check what was already sent', {
      companyId,
      module: 'billing.usage-alerts',
      error: error.message,
    });
    return null;
  }

  const seen = new Set<UsageAlertKey>();
  for (const row of data ?? []) {
    const payload = (row as { data_json?: Record<string, unknown> }).data_json;
    const key = reasonOf(payload);
    const createdAt = (row as { created_at?: string }).created_at ?? '';
    const draft = drafts.find((d) => d.key === key);
    // Each alert is judged against its OWN window start, not the earliest one:
    // the reply window is the Stripe period and the credit window is the
    // calendar month, and they rarely begin on the same day.
    if (draft && createdAt >= draft.windowStart) seen.add(draft.key);
  }
  return seen;
}

/**
 * Check one company's meters and raise whatever warnings are newly due.
 *
 * Safe to call from anywhere and as often as you like — the dedupe above makes
 * a second call in the same window a no-op. Called from the billing cron
 * (`src/app/api/cron/billing/route.ts`) once the monthly credit has been
 * replenished, so a company that has just been topped up is never warned about
 * a balance it no longer has.
 */
export async function sendUsageAlerts(companyId: string): Promise<UsageAlertRun> {
  const none: UsageAlertRun = { companyId, sent: [] };

  const sub = await getSubscription(companyId);
  // A suspended or cancelled account is silent on purpose and its owner has
  // already been told why. Warning them that their allowance is running out
  // would be noise about a service they are not receiving.
  if (sub && (sub.status === 'suspended' || sub.status === 'canceled')) return none;

  const [usage, wallet] = await Promise.all([
    getReplyAllowanceUsage(companyId),
    readWallet(companyId),
  ]);

  const drafts = [
    ...(wallet ? await creditAlerts(companyId, wallet) : []),
    ...replyAlerts(usage),
  ];
  if (drafts.length === 0) return none;

  const seen = await alreadySent(companyId, drafts);
  if (!seen) return none;

  const sent: UsageAlertKey[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.key)) continue;
    try {
      const result = await notify({
        companyId,
        type: ALERT_NOTIFICATION_TYPE,
        title: draft.title,
        body: draft.body,
        // `reason` is the key the inbound gate reads too — see the vocabulary
        // above. Spread last so a draft can never shadow it.
        data: { windowStart: draft.windowStart, ...draft.data, reason: draft.key },
        email: true,
      });
      // An alert whose row did not land was not sent: nothing went out, and
      // nothing recorded that it did. Counting it here would tell the cron log a
      // warning was delivered that the customer never saw, and the next sweep
      // retries it — which is the recovery, not a duplicate.
      if (!result.persisted) {
        logger.warn('Usage alert was not recorded, so it was not sent', {
          companyId,
          module: 'billing.usage-alerts',
          reason: draft.key,
        });
        continue;
      }
      sent.push(draft.key);
    } catch (err) {
      // One alert failing must not swallow the other meter's warning — the two
      // have different causes and different fixes.
      logger.error('Usage alert could not be sent', {
        companyId,
        module: 'billing.usage-alerts',
        reason: draft.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (sent.length > 0) {
    logger.info('Usage alerts raised', { companyId, module: 'billing.usage-alerts', sent });
  }
  return { companyId, sent };
}
