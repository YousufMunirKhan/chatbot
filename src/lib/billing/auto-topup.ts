import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { getPlatformStripeSettings } from '@/lib/platform-settings';

/**
 * Automatic credit top-up (migration 0057).
 *
 * The platform sells prepaid AI credit (migration 0024). When the balance runs
 * out the assistant stops answering, which is the worst possible moment to
 * discover that nobody watched a number. This charges a saved Stripe payment
 * method off-session and credits the ledger before that happens.
 *
 * Three things this has to get right, because it moves real money:
 *
 *  1. NEVER CHARGE TWICE. The charge is only made by the caller that wins a
 *     conditional update on `claimed_at` — a compare-and-set the database
 *     serialises for us. A second concurrent call sees the claim and returns
 *     `already_running` without touching Stripe. A crashed process leaks its
 *     claim, so a claim older than `CLAIM_TTL_MS` is takeable again.
 *  2. STOP AFTER REPEATED FAILURES. An expired card would otherwise be retried
 *     on every message forever, and Stripe treats that as card testing. Three
 *     consecutive failures disable the feature and record why.
 *  3. NEVER THROW AT THE CALL SITE. Every path returns a result object; the
 *     caller is a background hook, not a user-facing request.
 *
 * Wiring: call `maybeAutoTopUp(companyId)` from wherever credit is spent or on
 * a schedule. Nothing calls it implicitly — the company billing page exposes a
 * manual "Top up now" that runs the same code path end to end.
 */

/** Consecutive failures after which auto top-up turns itself off. */
export const MAX_CONSECUTIVE_FAILURES = 3;
/** A claim older than this belonged to a process that died mid-charge. */
export const CLAIM_TTL_MS = 5 * 60_000;

export type AutoTopUpStatus =
  | 'charged'
  | 'not_configured'
  | 'disabled'
  | 'above_threshold'
  | 'already_running'
  | 'failed';

export interface AutoTopUpResult {
  status: AutoTopUpStatus;
  /** Machine-readable detail; safe to show to a company admin. */
  reason?: string;
  amountCents?: number;
  balanceBefore?: number;
}

export interface AutoTopUpConfig {
  companyId: string;
  isEnabled: boolean;
  thresholdCredits: number;
  topupAmountCents: number;
  stripePaymentMethodId: string | null;
  lastTopupAt: string | null;
  failureCount: number;
  disabledReason: string | null;
  claimedAt: string | null;
}

export interface AutoTopUpAttempt {
  id: string;
  status: 'succeeded' | 'failed';
  amountCents: number;
  balanceBefore: number | null;
  error: string | null;
  createdAt: string;
}

export function mapAutoTopUpRow(row: Record<string, unknown>): AutoTopUpConfig {
  return {
    companyId: row.company_id as string,
    isEnabled: row.is_enabled === true,
    thresholdCredits: Number(row.threshold_credits ?? 0),
    topupAmountCents: Number(row.topup_amount_cents ?? 0),
    stripePaymentMethodId: (row.stripe_payment_method_id as string) ?? null,
    lastTopupAt: (row.last_topup_at as string) ?? null,
    failureCount: Number(row.failure_count ?? 0),
    disabledReason: (row.disabled_reason as string) ?? null,
    claimedAt: (row.claimed_at as string) ?? null,
  };
}

/**
 * Pure decision: should this balance trigger a charge?
 *
 * Split out from the I/O so the rules that decide whether to move money can be
 * exercised without a database or a Stripe key. Everything below the decision
 * (claiming, charging, crediting) is mechanical.
 */
export function autoTopUpDecision(
  config: AutoTopUpConfig | null,
  balance: number | null,
): { attempt: boolean; status: AutoTopUpStatus; reason: string } {
  if (!config) return { attempt: false, status: 'not_configured', reason: 'No auto top-up settings.' };
  if (!config.isEnabled)
    return { attempt: false, status: 'disabled', reason: config.disabledReason ?? 'Auto top-up is off.' };
  if (config.failureCount >= MAX_CONSECUTIVE_FAILURES) {
    return {
      attempt: false,
      status: 'disabled',
      reason: config.disabledReason ?? `Stopped after ${MAX_CONSECUTIVE_FAILURES} failed payments.`,
    };
  }
  if (!config.stripePaymentMethodId)
    return { attempt: false, status: 'not_configured', reason: 'No saved payment method.' };
  if (config.topupAmountCents <= 0)
    return { attempt: false, status: 'not_configured', reason: 'Top-up amount is not set.' };
  if (balance == null)
    return { attempt: false, status: 'not_configured', reason: 'No credit account for this company.' };
  if (balance > config.thresholdCredits)
    return { attempt: false, status: 'above_threshold', reason: 'Balance is above the threshold.' };
  return { attempt: true, status: 'charged', reason: 'Balance is at or below the threshold.' };
}

/** True when a claim timestamp is old enough that its owner is presumed dead. */
export function isClaimStale(claimedAt: string | null, now: number = Date.now()): boolean {
  if (!claimedAt) return true;
  const at = new Date(claimedAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now - at >= CLAIM_TTL_MS;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

async function recordAttempt(params: {
  companyId: string;
  status: 'succeeded' | 'failed';
  amountCents: number;
  balanceBefore: number | null;
  paymentIntentId?: string | null;
  error?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('company_auto_topup_attempts').insert({
    company_id: params.companyId,
    status: params.status,
    amount_cents: params.amountCents,
    balance_before: params.balanceBefore,
    stripe_payment_intent_id: params.paymentIntentId ?? null,
    error: params.error ?? null,
  });
}

/** Charge the saved card off-session. Returns the PaymentIntent id on success. */
async function chargeOffSession(params: {
  secretKey: string;
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  companyId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body = new URLSearchParams();
  body.set('amount', String(params.amountCents));
  body.set('currency', 'gbp');
  body.set('customer', params.customerId);
  body.set('payment_method', params.paymentMethodId);
  body.set('confirm', 'true');
  // Off-session: no browser is present to complete a 3DS challenge, so Stripe
  // must decline rather than ask.
  body.set('off_session', 'true');
  body.set('description', 'Automatic AI credit top-up');
  body.set('metadata[company_id]', params.companyId);
  body.set('metadata[source]', 'auto_topup');

  let res: Response;
  try {
    res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Retrying a network timeout must not create a second charge. The key
        // changes only when the amount or the minute does.
        'Idempotency-Key': `auto-topup-${params.companyId}-${params.amountCents}-${Math.floor(Date.now() / 60_000)}`,
      },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error contacting Stripe.' };
  }

  const payload = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    error?: { message?: string };
  };
  if (!res.ok) return { ok: false, error: payload.error?.message ?? `Stripe returned ${res.status}.` };
  if (payload.status !== 'succeeded')
    return { ok: false, error: `Payment did not complete (status: ${payload.status ?? 'unknown'}).` };
  return { ok: true, id: payload.id ?? '' };
}

async function releaseClaim(companyId: string, patch: Record<string, unknown>): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('company_auto_topup')
    .update({ claimed_at: null, ...patch })
    .eq('company_id', companyId);
}

/**
 * Top up `companyId`'s credit if its balance has fallen to the threshold.
 * Safe to call concurrently and safe to call on every message.
 */
export async function maybeAutoTopUp(companyId: string): Promise<AutoTopUpResult> {
  if (!companyId) return { status: 'not_configured', reason: 'No company.' };
  const sb = createSupabaseServiceClient();

  const { data: configRow } = await sb
    .from('company_auto_topup')
    .select(
      'company_id,is_enabled,threshold_credits,topup_amount_cents,stripe_payment_method_id,last_topup_at,failure_count,disabled_reason,claimed_at',
    )
    .eq('company_id', companyId)
    .maybeSingle();
  const config = configRow ? mapAutoTopUpRow(configRow as Record<string, unknown>) : null;

  const { data: accountRow } = await sb
    .from('company_credit_accounts')
    .select('balance_amount,lifetime_credit_added')
    .eq('company_id', companyId)
    .maybeSingle();
  const account = accountRow as { balance_amount?: number; lifetime_credit_added?: number } | null;
  const balance = account ? Number(account.balance_amount ?? 0) : null;

  const decision = autoTopUpDecision(config, balance);
  if (!decision.attempt || !config) {
    return { status: decision.status, reason: decision.reason, balanceBefore: balance ?? undefined };
  }

  // --- claim -------------------------------------------------------------
  // The only guard against a double charge. `or(...)` is evaluated by the
  // database alongside the write, so exactly one concurrent caller updates a
  // row and gets it back; everyone else gets nothing.
  const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data: claimed } = await sb
    .from('company_auto_topup')
    .update({ claimed_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .select('company_id')
    .maybeSingle();
  if (!claimed) {
    return { status: 'already_running', reason: 'Another top-up is in progress.', balanceBefore: balance ?? undefined };
  }

  const amountCents = config.topupAmountCents;

  try {
    const stripe = await getPlatformStripeSettings();
    const { data: subRow } = await sb
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();
    const customerId = (subRow as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null;

    if (!stripe.enabled || !stripe.secretKey) {
      return await failAttempt(config, balance, amountCents, 'Stripe is not configured on this platform.');
    }
    if (!customerId) {
      return await failAttempt(config, balance, amountCents, 'No Stripe customer on this account.');
    }

    const charge = await chargeOffSession({
      secretKey: stripe.secretKey,
      customerId,
      paymentMethodId: config.stripePaymentMethodId as string,
      amountCents,
      companyId,
    });
    if (!charge.ok) return await failAttempt(config, balance, amountCents, charge.error);

    // --- credit the ledger ------------------------------------------------
    const credit = round4(amountCents / 100);
    await sb
      .from('company_credit_accounts')
      .update({
        balance_amount: round4((balance ?? 0) + credit),
        lifetime_credit_added: round4(Number(account?.lifetime_credit_added ?? 0) + credit),
      })
      .eq('company_id', companyId);
    await sb.from('company_credit_transactions').insert({
      company_id: companyId,
      type: 'top_up',
      amount: credit,
      currency: 'GBP',
      description: 'Automatic top-up',
      metadata_json: { source: 'auto_topup', stripePaymentIntentId: charge.id },
    });

    await releaseClaim(companyId, {
      last_topup_at: new Date().toISOString(),
      failure_count: 0,
      disabled_reason: null,
    });
    await recordAttempt({
      companyId,
      status: 'succeeded',
      amountCents,
      balanceBefore: balance,
      paymentIntentId: charge.id,
    });

    return { status: 'charged', amountCents, balanceBefore: balance ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Auto top-up crashed', { companyId, error: message, module: 'billing/auto-topup' });
    return await failAttempt(config, balance, amountCents, message);
  }
}

/** Record a failed attempt, count it, and switch the feature off at the cutoff. */
async function failAttempt(
  config: AutoTopUpConfig,
  balance: number | null,
  amountCents: number,
  error: string,
): Promise<AutoTopUpResult> {
  const nextCount = config.failureCount + 1;
  const exhausted = nextCount >= MAX_CONSECUTIVE_FAILURES;
  await releaseClaim(config.companyId, {
    failure_count: nextCount,
    is_enabled: exhausted ? false : config.isEnabled,
    disabled_reason: exhausted
      ? `Turned off after ${MAX_CONSECUTIVE_FAILURES} failed payments. Last error: ${error}`
      : error,
  });
  await recordAttempt({
    companyId: config.companyId,
    status: 'failed',
    amountCents,
    balanceBefore: balance,
    error,
  });
  logger.warn('Auto top-up failed', {
    companyId: config.companyId,
    failureCount: nextCount,
    disabled: exhausted,
    error,
    module: 'billing/auto-topup',
  });
  return { status: 'failed', reason: error, amountCents, balanceBefore: balance ?? undefined };
}
