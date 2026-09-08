import Stripe from 'stripe';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { logger } from '@/lib/logger';
import { getPlatformStripeSettings } from '@/lib/platform-settings';
import { applyCreditMovement, resolveIncludedCredit } from '@/lib/billing/credits';
import {
  getBillingPlan,
  listStripePriceMappings,
  type BillingPlan,
} from '@/modules/super-admin/billing-data';
import { PLANS, type PlanKey } from '@/modules/super-admin/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * This deployment cannot verify a Stripe signature at all.
 *
 * Kept apart from a failed verification because the two are different faults
 * with different answers. A signature that does not check out is somebody
 * else's request and gets a 400 — retrying it would only fail again. This one is
 * ours, and gets a 5xx so Stripe keeps retrying: the genuine events queued
 * behind a missing secret then land as soon as it is configured, instead of
 * being dropped on the floor while the platform looks like it is working.
 */
class StripeWebhookUnconfiguredError extends Error {
  constructor(missing: string) {
    super(`Stripe webhook verification is not configured: ${missing} is missing.`);
    this.name = 'StripeWebhookUnconfiguredError';
  }
}

/**
 * A signature-verified Stripe event, or nothing at all.
 *
 * This used to fall back to `JSON.parse(body)` when the webhook secret or the
 * secret key was missing, with a warning in the log, and then treat the result
 * as a genuine event. That made every write below reachable by anyone who knew
 * the URL: a POST of
 *
 *   {"type":"checkout.session.completed","data":{"object":{
 *     "client_reference_id":"<any company uuid>","metadata":{"plan":"free_trial"}}}}
 *
 * moved any company on the platform — paying or comped — onto 100 replies. An
 * unauthenticated write to the billing table is not made safe by logging that it
 * might happen.
 *
 * An unconfigured webhook secret is a MISCONFIGURATION, not a mode of
 * operation. There is no such thing as an unsigned Stripe event: Stripe signs
 * every delivery, so a request that cannot be verified is either forged or
 * arriving at a deployment nobody has finished setting up. Neither is a reason
 * to write to `subscriptions`, so both are refused, loudly.
 */
async function parseStripeEvent(req: Request): Promise<Stripe.Event> {
  const settings = await getPlatformStripeSettings();
  const body = await req.text();
  if (!settings.secretKey) throw new StripeWebhookUnconfiguredError('stripe.secret_key');
  if (!settings.webhookSecret) throw new StripeWebhookUnconfiguredError('stripe.webhook_secret');

  const signature = req.headers.get('stripe-signature');
  if (!signature) throw new Error('Missing Stripe signature.');
  const stripe = new Stripe(settings.secretKey);
  // Verifies against the RAW body, which is why this reads `req.text()` and
  // never `req.json()`: re-serialising the payload changes the bytes the
  // signature was computed over and every genuine event would be rejected.
  return stripe.webhooks.constructEvent(body, signature, settings.webhookSecret);
}

// ---------------------------------------------------------------------------
// Reading the row we are about to change
// ---------------------------------------------------------------------------

const SUBSCRIPTION_COLUMNS =
  'company_id,plan,status,free_until,message_limit,bot_limit,agent_limit,integration_limit,stripe_subscription_id,included_credit_gbp';

interface SubscriptionSnapshot {
  companyId: string;
  plan: string | null;
  status: string | null;
  freeUntil: string | null;
  messageLimit: number | null;
  botLimit: number | null;
  agentLimit: number | null;
  integrationLimit: number | null;
  stripeSubscriptionId: string | null;
  /** `subscriptions.included_credit_gbp` (migration 0093). NULL inherits the package. */
  includedCreditGbp: number | null;
}

function toSnapshot(row: Record<string, unknown>): SubscriptionSnapshot {
  return {
    companyId: row.company_id as string,
    plan: (row.plan as string) ?? null,
    status: (row.status as string) ?? null,
    freeUntil: (row.free_until as string) ?? null,
    messageLimit: row.message_limit == null ? null : Number(row.message_limit),
    botLimit: row.bot_limit == null ? null : Number(row.bot_limit),
    agentLimit: row.agent_limit == null ? null : Number(row.agent_limit),
    integrationLimit: row.integration_limit == null ? null : Number(row.integration_limit),
    stripeSubscriptionId: (row.stripe_subscription_id as string) ?? null,
    includedCreditGbp:
      row.included_credit_gbp == null ? null : Number(row.included_credit_gbp),
  };
}

/**
 * The subscription this event is about, read BEFORE it is overwritten.
 *
 * The service-role client bypasses RLS, so the `.eq` here is the tenant
 * boundary. Both match values come out of a signature-verified Stripe payload —
 * `client_reference_id` is the company id this deployment itself put on the
 * checkout session, echoed back — which is only trustworthy because
 * `parseStripeEvent` now refuses anything it cannot verify. Nothing here may be
 * taken from an unverified request body.
 */
async function readSubscriptionBy(
  sb: ServiceClient,
  column: 'company_id' | 'stripe_subscription_id',
  value: string,
): Promise<SubscriptionSnapshot | null> {
  const { data, error } = await sb
    .from('subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  return data ? toSnapshot(data as Record<string, unknown>) : null;
}

/**
 * A record of a billing change Stripe made, written before the change lands.
 *
 * Never blocks: by the time one of these is written the customer's card has
 * already been charged, and refusing to apply what they paid for because a log
 * row would not insert is the worse failure. So the whole entry is also handed
 * to the logger when the insert fails — the "what it was before" survives in two
 * places, and an operator can reconstruct an overwritten grant from either.
 */
async function recordBillingAudit(
  sb: ServiceClient,
  entry: {
    companyId: string;
    action: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await sb.from('audit_logs').insert({
    company_id: entry.companyId,
    // No actor: Stripe did this, not a person. `actor_user_id` is nullable and
    // the reader renders an unattributed row rather than inventing a name.
    actor_user_id: null,
    action: entry.action,
    target_type: 'subscription',
    target_id: entry.companyId,
    metadata_json: entry.metadata,
  });
  if (error) {
    logger.error('Stripe webhook could not write its audit record', {
      companyId: entry.companyId,
      action: entry.action,
      entry: entry.metadata,
      error: error.message,
    });
  }
}

// ---------------------------------------------------------------------------
// Plan resolution
// ---------------------------------------------------------------------------

/** Stripe returns either the id or the expanded object, depending on the call. */
function stripeIdOf(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.id ?? null;
}

function isoFromUnixSeconds(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

/**
 * Every outcome of "which package is this Stripe subscription on?".
 *
 * A discriminated result rather than `BillingPlan | null` because the four ways
 * of failing need four different log lines: an operator who has not mapped a
 * price yet, an operator who has mapped two packages to the same price, and a
 * catalogue that has lost a package are three separate things to go and fix.
 */
type PlanResolution =
  | { outcome: 'resolved'; plan: BillingPlan; priceIds: string[] }
  | { outcome: 'no_prices' }
  | { outcome: 'unmapped'; priceIds: string[] }
  | { outcome: 'ambiguous'; priceIds: string[]; plans: string[] }
  | { outcome: 'unknown_plan'; planKey: string };

/**
 * The package a Stripe subscription's prices correspond to.
 *
 * `stripe_price_mappings` (migration 0018) is written forwards — one row per
 * package, carrying the price id checkout should use — and read forwards by
 * `src/app/api/billing/checkout/route.ts`. This is the reverse: the price comes
 * off the subscription and the package has to be recovered from it. Two things
 * about the table shape matter here. `plan` is unique but `stripe_price_id` is
 * NOT, so two packages CAN point at one price and the answer is then genuinely
 * ambiguous. And `enabled` is deliberately ignored: it means "do not offer this
 * in checkout", which says nothing about a subscription somebody is already
 * paying for, and treating a retired package as unmapped would strip the limits
 * off the customers still on it.
 *
 * A subscription can carry several items (a base price plus metered overage, for
 * one), so every item's price is considered and exactly one distinct package has
 * to come back.
 */
async function resolvePlanFromSubscription(
  subscription: Stripe.Subscription,
): Promise<PlanResolution> {
  const priceIds = [
    ...new Set(
      (subscription.items?.data ?? [])
        .map((item) => stripeIdOf(item.price))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (priceIds.length === 0) return { outcome: 'no_prices' };

  // One row per package, so the whole table is a handful of rows and filtering
  // it in memory costs less than a second round trip would.
  const mappings = await listStripePriceMappings();
  const planKeys = [
    ...new Set(mappings.filter((m) => priceIds.includes(m.stripePriceId)).map((m) => m.plan)),
  ];
  if (planKeys.length > 1) return { outcome: 'ambiguous', priceIds, plans: planKeys };

  const [planKey] = planKeys;
  if (planKey === undefined) return { outcome: 'unmapped', priceIds };

  const plan = await getBillingPlan(planKey);
  if (!plan) return { outcome: 'unknown_plan', planKey };
  return { outcome: 'resolved', plan, priceIds };
}

/** The four columns a package sets on a subscription row. */
function limitsOf(plan: BillingPlan) {
  return {
    message_limit: plan.messageLimit,
    bot_limit: plan.botLimit,
    agent_limit: plan.agentLimit,
    integration_limit: plan.integrationLimit,
  };
}

function limitsSnapshot(snapshot: SubscriptionSnapshot) {
  return {
    messageLimit: snapshot.messageLimit,
    botLimit: snapshot.botLimit,
    agentLimit: snapshot.agentLimit,
    integrationLimit: snapshot.integrationLimit,
  };
}

// ---------------------------------------------------------------------------
// Funding the wallet the purchase paid for
// ---------------------------------------------------------------------------

/**
 * Bring a company's AI wallet up to what the package Stripe just billed for
 * includes.
 *
 * THE DEFECT THIS REMOVES
 * -----------------------
 * Granting a package and funding the wallet that package needs are one decision,
 * and until now this file only did the first half. A reply passes three gates
 * (`checkReplyGates`), and the third is the prepaid wallet: an answer is allowed
 * only while `company_credit_accounts.balance_amount` is above zero. So the
 * commonest path into becoming a paying customer — sign up, try the trial, buy
 * Starter the same day — put a company on a package whose included credit is £7
 * (or £97, or £242) while the wallet held the trial's £2, and left it there.
 *
 * The monthly job cannot rescue them. `replenishMonthlyCredit` is locked by
 * migration 0089's one-`included_credit`-row-per-company-per-UTC-month index, and
 * provisioning already spent this month's row seeding the trial's £2. The
 * customer's assistant therefore went quiet within days of them paying and stayed
 * quiet until the 1st. That is the exact failure the whole change exists to
 * remove, sitting on the path most customers take.
 *
 * WHY A `top_up` ROW AND NOT AN `included_credit` ONE
 * ---------------------------------------------------
 * Because the 0089 index is the thing standing in the way. An `included_credit`
 * row for a month that already has one comes back `duplicate` — the lock working
 * exactly as designed — and the upgrade would deliver nothing, which is the bug
 * rather than a fix for it. And if it somehow did land it would consume that
 * month's single grant slot, so the purchase would silently cancel the monthly
 * replenishment. A purchase grant and the monthly allowance are two different
 * facts about the same wallet, so they are two different rows, and neither can
 * eat the other. `fundWalletForPlan` in the super-admin actions reached the same
 * conclusion for the comp path and this deliberately matches it: same movement,
 * same ledger type, `source` in the metadata saying which event caused it.
 *
 * WHY A REDELIVERY CANNOT STACK CREDIT
 * ------------------------------------
 * Stripe redelivers events, so everything here has to be safe to run twice. The
 * safety is not a dedupe table: `apply_credit_movement` with `toBalance` tops up
 * TO a figure and never past it, so a second delivery finds the wallet already at
 * the package's figure, returns `no_change` and writes nothing at all — no ledger
 * row, no balance move. If the customer spent some of it between the two
 * deliveries the redelivery restores it up to the figure they were sold and no
 * further, so the most this event can ever grant is one package allowance, not
 * one per delivery. That is the same property the operator's form relies on when
 * somebody presses save twice.
 *
 * WHY A DOWNGRADE CANNOT CLAW MONEY BACK
 * --------------------------------------
 * The movement is clamped in SQL at `greatest(0, target - balance)`. A move to a
 * SMALLER package computes a zero delta, writes no ledger row and leaves the
 * balance alone. Money in a wallet has been paid for — by the customer or by an
 * operator's grant — and nothing in this file may take it out.
 */
async function fundWalletForPurchase(
  sb: ServiceClient,
  params: {
    companyId: string;
    plan: BillingPlan;
    /** `subscriptions.included_credit_gbp` — this company's own figure, or null. */
    perCompanyIncludedCredit: number | null;
    /** The reply cap this event actually wrote. `null` (unlimited) reaches the floor. */
    messageLimit: number | null;
    source: 'stripe_checkout' | 'stripe_subscription_update';
    /** The checkout session or subscription id, for the ledger and the log. */
    reference: string;
  },
): Promise<void> {
  const { companyId, plan } = params;
  // The same resolution `replenishMonthlyCredit` will use on the 1st, so the
  // wallet this purchase funds and the wallet the cron tops up next month agree
  // on one figure. Resolving it here rather than reading `plan.includedCreditGbp`
  // straight is what keeps a per-company negotiated figure, and the uncapped-plan
  // floor behind `custom`, from being overwritten by a catalogue zero.
  const included = resolveIncludedCredit({
    perCompany: params.perCompanyIncludedCredit,
    catalogue: plan.includedCreditGbp,
    mapped: plan.key in PLANS ? PLANS[plan.key as PlanKey].includedCreditGbp : undefined,
    messageLimit: params.messageLimit,
  });
  // A deliberate zero — an operator who typed 0 into the per-company figure —
  // means this company gets no AI credit, and is honoured rather than argued with.
  if (!Number.isFinite(included) || included <= 0) return;

  const movement = await applyCreditMovement({
    companyId,
    type: 'top_up',
    toBalance: included,
    description: `AI credit brought up to the ${plan.key} package allowance (£${included.toFixed(2)})`,
    metadata: {
      plan: plan.key,
      includedCreditGbp: included,
      source: params.source,
      reference: params.reference,
    },
  });

  if (movement.status === 'failed' || movement.status === 'duplicate') {
    // The customer's card has been charged and their package is on the row, but
    // the wallet behind it did not move — so they are paying for replies the
    // third gate will refuse. `duplicate` is impossible for a `top_up` (0089's
    // index covers `included_credit` only) and is treated as a failure rather
    // than quietly accepted, because if it ever happens the money did not land.
    //
    // Audited BEFORE the throw so the evidence survives even if Stripe
    // eventually gives up retrying, then thrown so it retries at all: a repeat
    // delivery re-applies the same end state and, once the wallet is funded,
    // costs nothing (`no_change`). Silence here would put us back in the failure
    // this function exists to remove, with nobody watching.
    logger.error(
      'A paid Stripe event applied the package but could not fund the wallet behind it. ' +
        'This customer is paying for replies the credit gate will refuse until the wallet ' +
        'is topped up.',
      {
        companyId,
        plan: plan.key,
        includedCreditGbp: included,
        movementStatus: movement.status,
        source: params.source,
        reference: params.reference,
        error: movement.error ?? null,
      },
    );
    await recordBillingAudit(sb, {
      companyId,
      action: 'subscription.stripe_wallet_unfunded',
      metadata: {
        plan: plan.key,
        includedCreditGbp: included,
        movementStatus: movement.status,
        source: params.source,
        reference: params.reference,
        error: movement.error ?? null,
      },
    });
    throw new Error(movement.error ?? `the wallet movement returned ${movement.status}`);
  }

  // `no_account` — credit is not tracked for this company at all
  // (`getAiCreditAccess` lets those replies through), so there is nothing to fund
  // and no wallet is invented here. `no_change` — the wallet already holds more
  // than the package includes and keeps every penny of it.
  if (movement.status !== 'applied') return;

  logger.info('A Stripe purchase funded the wallet for its package', {
    companyId,
    plan: plan.key,
    from: movement.balanceBefore,
    to: movement.balanceAfter,
    source: params.source,
    reference: params.reference,
  });
}

/**
 * A write the database refused because of the `plan` value in it.
 *
 * Only two codes can mean that here. 23514 is a check constraint — what
 * `subscriptions.plan` used to be, and still is on any database that has not run
 * migration 0096 — and 23503 is the foreign key that replaced it, which fires if
 * the catalogue row is deleted between resolving the package and writing it. No
 * other column in these patches can raise either: `status` is mapped by
 * `SUBSCRIPTION_STATUS_FOR` to a value its own constraint allows, and the two
 * period columns are plain timestamps with nothing to violate. The caller
 * confirms the diagnosis anyway by retrying without the package.
 */
function isPlanColumnRejection(error: { code?: string | null } | null): boolean {
  const code = error?.code ?? null;
  return code === '23514' || code === '23503';
}

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

/** `null` is unlimited, so it beats any number. */
function moreGenerousLimit(current: number | null, purchased: number | null): number | null {
  if (current === null || purchased === null) return null;
  return Math.max(current, purchased);
}

function isFutureDate(value: string | null): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && at > Date.now();
}

/**
 * Apply a completed checkout to the company's subscription.
 *
 * THE COMP THIS USED TO DESTROY
 * -----------------------------
 * This branch overwrote the package, all four limits and `free_until`, matched
 * on `company_id`, with no record of what had been there. This product
 * deliberately lets an operator grant a company any package for nothing, with
 * bespoke limits — and a company comped to Pro whose admin then bought Starter
 * for £19 was silently reset to Starter's numbers. The grant, and any per-company
 * override an operator had set deliberately, were gone with nothing on any
 * screen to say so and nothing in the log to restore them from.
 *
 * Two things changed, and neither of them blocks a genuine paid upgrade.
 *
 * 1. The previous package and limits are written to `audit_logs` before they are
 *    overwritten, on every checkout, comped or not. That is the floor: whatever
 *    else happens, an operator can see what was lost and put it back.
 *
 * 2. For a company that has never had a Stripe subscription, the four limits are
 *    floored at what the row already carries. `stripe_subscription_id is null`
 *    is a fact rather than a guess: nothing but this webhook ever writes that
 *    column, so a row without one holds exactly what an operator (or
 *    provisioning) put there. Flooring means a purchase can raise what a company
 *    may do and can never quietly lower it.
 *
 *    This is invisible in the ordinary case, which is the point. A trial company
 *    buying Starter is floored from (100, 1, 1, 0) against (500, 1, 1, 1) and
 *    gets exactly Starter. The floor only bites where an operator really did
 *    grant more than the package being bought, and there the operator's decision
 *    wins until the operator changes it — one click on the subscription form —
 *    because a grant destroyed by a webhook cannot be recovered by anyone who
 *    was not watching the log.
 *
 * What the purchase always takes is the `plan` key itself, and with it the
 * feature entitlements that key off it (`src/lib/entitlements.ts`). The company
 * is paying Stripe for that package and the billing page has to agree with the
 * invoice. The previous key is in the audit row, so an operator who was
 * deliberately granting a feature can restore it as a per-company exception.
 */
async function handleCheckoutCompleted(
  sb: ServiceClient,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const companyId = session.client_reference_id;
  const planKey = session.metadata?.plan ?? null;
  if (!companyId || !planKey) {
    logger.warn('Stripe checkout completed without a company or plan to apply', {
      sessionId: session.id,
      companyId: companyId ?? undefined,
      planKey,
    });
    return;
  }

  const plan = await getBillingPlan(planKey);
  if (!plan) {
    // The key was put on the session by this app's own checkout route, so a
    // package that no longer exists means the catalogue changed mid-flight.
    // Guessing a replacement would sell the customer something nobody chose.
    logger.error('Stripe checkout names a package the catalogue does not have', {
      companyId,
      planKey,
      sessionId: session.id,
    });
    await recordBillingAudit(sb, {
      companyId,
      action: 'subscription.stripe_checkout_unapplied',
      metadata: { reason: 'unknown_plan', planKey, sessionId: session.id },
    });
    return;
  }

  const current = await readSubscriptionBy(sb, 'company_id', companyId);
  if (!current) {
    // Paid for, with nowhere to put it. Every company gets a subscription row at
    // provisioning, so this is a data fault worth a person looking at rather
    // than something to paper over by inventing a row here.
    logger.error('Stripe checkout completed for a company with no subscription row', {
      companyId,
      planKey,
      sessionId: session.id,
    });
    await recordBillingAudit(sb, {
      companyId,
      action: 'subscription.stripe_checkout_unapplied',
      metadata: { reason: 'no_subscription_row', planKey, sessionId: session.id },
    });
    return;
  }

  /*
   * "This company has never been billed through Stripe", which is what decides
   * whether the limits below are floored at what an operator granted.
   *
   * The second half of the test is about REDELIVERY, and it matters more now
   * than it did: Stripe redelivers an event whenever this route answers 5xx, and
   * funding the wallet (at the bottom of this function) is a step that can fail
   * after the write below has already landed. On that second delivery the row
   * carries a `stripe_subscription_id` — the one THIS session created — so the
   * plain null test would read the company as an established Stripe customer and
   * write the package's raw limits, quietly undoing the operator grant the first
   * delivery deliberately preserved. A comp is load-bearing in this product and
   * must not be destroyed by a retry of the very event that saved it.
   *
   * Recognising our own footprint is exact rather than a heuristic: nothing but
   * this webhook writes that column, and the id being compared came out of the
   * signature-verified session. A LATER, genuinely different purchase carries a
   * different subscription id and is still treated as an established customer,
   * which is the existing behaviour and is unchanged.
   */
  const purchasedSubscriptionId = stripeIdOf(session.subscription);
  const operatorGranted =
    current.stripeSubscriptionId === null ||
    (purchasedSubscriptionId !== null && current.stripeSubscriptionId === purchasedSubscriptionId);
  const purchased = limitsOf(plan);
  const limits = operatorGranted
    ? {
        message_limit: moreGenerousLimit(current.messageLimit, purchased.message_limit),
        bot_limit: moreGenerousLimit(current.botLimit, purchased.bot_limit),
        agent_limit: moreGenerousLimit(current.agentLimit, purchased.agent_limit),
        integration_limit: moreGenerousLimit(current.integrationLimit, purchased.integration_limit),
      }
    : purchased;

  // `free_until` is an operator's written promise of free service. It gates
  // nothing in code, so keeping it costs nothing, and clearing it on a company
  // that has never been billed through Stripe would erase the only trace of the
  // arrangement. A company that already had a Stripe subscription keeps the old
  // behaviour: they are billed, the date is spent.
  const keepFreeUntil = operatorGranted && isFutureDate(current.freeUntil);

  const preserved = Object.entries(limits)
    .filter(([column, value]) => value !== purchased[column as keyof typeof purchased])
    .map(([column]) => column);
  if (keepFreeUntil) preserved.push('free_until');

  await recordBillingAudit(sb, {
    companyId,
    action: 'subscription.stripe_checkout_applied',
    metadata: {
      plan: plan.key,
      previousPlan: current.plan,
      previousStatus: current.status,
      previousFreeUntil: current.freeUntil,
      previousLimits: limitsSnapshot(current),
      appliedLimits: limits,
      // Named so the operator's own screen can say what survived the purchase
      // and what the package would otherwise have set. Empty for the ordinary
      // trial-to-paid upgrade, which is most of them.
      operatorGrantPreserved: preserved,
      // Not "was comped": a company can have no Stripe subscription simply
      // because this is its first purchase — or because the only one it has is
      // the one this very session created and this is a redelivery. It is the
      // flag that decided whether the limits were floored, and it is recorded as
      // exactly that.
      hadNoOtherStripeSubscription: operatorGranted,
      previousStripeSubscriptionId: current.stripeSubscriptionId,
      sessionId: session.id,
    },
  });

  const { data: updated, error: updateError } = await sb
    .from('subscriptions')
    .update({
      status: 'active',
      plan: plan.key,
      free_until: keepFreeUntil ? current.freeUntil : null,
      ...limits,
      stripe_customer_id: stripeIdOf(session.customer),
      stripe_subscription_id: purchasedSubscriptionId,
    })
    .eq('company_id', companyId)
    .select('company_id');
  // Deliberately NOT split into "trusted" and "package" the way
  // `handleSubscriptionChanged` is. There the package is one field of a wider
  // event and the status is worth saving on its own; here the package IS the
  // purchase, and recording an active subscription against the customer's OLD
  // limits would be a worse lie than recording nothing and retrying. `plan.key`
  // came from `billing_plans` a moment ago, so migration 0096's foreign key is
  // already satisfied unless the catalogue row was deleted in between — a race a
  // retry resolves.
  if (updateError) throw updateError;
  // PostgREST reports no error for an update that matched nothing, and this row
  // was read a moment ago, so an empty result means it was deleted underneath
  // us. Silence here would mean a paid customer on their old package.
  if (!updated || updated.length === 0) {
    logger.error('Stripe checkout matched no subscription row when writing', {
      companyId,
      planKey: plan.key,
      sessionId: session.id,
    });
    return;
  }

  if (preserved.length > 0) {
    logger.warn('A paid checkout landed on a comped company; the operator grant was kept', {
      companyId,
      plan: plan.key,
      previousPlan: current.plan,
      preserved,
    });
  }

  // The package is on the row; this is the other half of the same purchase. It
  // runs AFTER the write on purpose — the figure depends on the reply cap that
  // was actually applied (a floored, operator-granted `null` is unlimited and
  // must not be capped by its wallet instead), and funding a package that failed
  // to land would be crediting a purchase nobody has.
  await fundWalletForPurchase(sb, {
    companyId,
    plan,
    perCompanyIncludedCredit: current.includedCreditGbp,
    messageLimit: limits.message_limit,
    source: 'stripe_checkout',
    reference: session.id,
  });
}

// ---------------------------------------------------------------------------
// customer.subscription.updated / .deleted
// ---------------------------------------------------------------------------

/**
 * Stripe's subscription status → the one this column accepts.
 *
 * `subscriptions.status` carries a check constraint (migration 0004) allowing
 * five values, and Stripe has nine. The old code wrote Stripe's word straight
 * into the column, so `incomplete`, `unpaid` and `paused` produced a 23514 that
 * the handler swallowed on its way to returning 200 — the status simply never
 * moved and nothing said so.
 *
 * Two of Stripe's have no honest equivalent and are deliberately absent, which
 * leaves the stored status untouched rather than guessing:
 *
 *   `incomplete` — the first payment has not settled yet. It resolves within
 *   the hour into `active` or `incomplete_expired`, and `checkout.session
 *   .completed` is what turns the subscription on in this system anyway.
 *
 *   `paused` — the nearest column value is `suspended`, which in this product
 *   means an OPERATOR suspended the company (`setCompanyStatusAction` mirrors
 *   it from the company row). Writing it from here would make the two
 *   indistinguishable, and an operator pressing "activate" would then silently
 *   contradict Stripe.
 */
const SUBSCRIPTION_STATUS_FOR: Record<string, string | undefined> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  // Stripe stops retrying an `unpaid` subscription but leaves it alive; the
  // customer owes money, which is what `past_due` says here.
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
};

/**
 * Apply a subscription change Stripe made outside checkout.
 *
 * THE UPGRADE THAT DID NOTHING
 * ----------------------------
 * The billing page's "Change package" button opens Stripe's hosted subscription
 * update flow, and this branch wrote `{ status }` and nothing else. So a
 * customer who moved Starter -> Business inside the portal was charged £49 and
 * kept 500 replies, one assistant, one seat and one integration — and because
 * `src/lib/entitlements.ts` keys off `subscriptions.plan`, they kept Starter's
 * features too. They paid more for nothing, and nothing on any screen said so.
 *
 * The package is now recovered from the price on the subscription and written
 * with all four limits, the same way `checkout.session.completed` does.
 *
 * FAILING CLOSED IS DELIBERATE
 * ----------------------------
 * When the price cannot be resolved to exactly one package — not mapped, mapped
 * twice, naming a package the catalogue has lost, or naming one the `plan`
 * column itself refuses (see the write at the bottom of this function) — the
 * package and the limits are LEFT ALONE and the event is logged and audited
 * instead. Nothing is guessed, and nothing is wiped: a wrong downgrade is far
 * worse than a late upgrade. A customer left on yesterday's limits for an hour
 * while an operator adds a price mapping is an inconvenience; a customer
 * silently dropped to unmapped-and-therefore-nothing is an outage, and one
 * caused by us.
 *
 * The status is written either way, because the event carries it directly and
 * needs no lookup to be correct — as long as Stripe's word has an equivalent in
 * this column, which `SUBSCRIPTION_STATUS_FOR` above decides. That is why the
 * patch is assembled in two halves below: what the event alone proves goes in
 * `trusted` and is written whatever happens to the package.
 *
 * The billing period is written too. `allowanceWindowFor` in
 * `src/lib/billing/index.ts` prefers `current_period_start`/`current_period_end`
 * precisely so a customer who subscribed on the 25th does not get a second full
 * allowance on the 1st — but its comment said the webhook writes them and the
 * webhook never did, so every company fell back to the calendar month. Now they
 * are written on the event that carries them.
 */
async function handleSubscriptionChanged(
  sb: ServiceClient,
  subscription: Stripe.Subscription,
  canceled: boolean,
): Promise<void> {
  const current = await readSubscriptionBy(sb, 'stripe_subscription_id', subscription.id);
  if (!current) {
    // Not an error. `checkout.session.completed` is what first writes
    // `stripe_subscription_id`, and Stripe does not promise to deliver these two
    // in order — the checkout event applies the whole package anyway when it
    // lands, so an early `.updated` has nothing to do.
    logger.info('Stripe subscription event for a subscription this platform has not linked yet', {
      stripeSubscriptionId: subscription.id,
      eventStatus: subscription.status,
    });
    return;
  }

  const status = canceled ? 'canceled' : SUBSCRIPTION_STATUS_FOR[subscription.status];
  // The half of the patch the event proves on its own. Kept apart from the
  // package so that a package the database will not accept cannot take the
  // status and the billing period down with it.
  const trusted: Record<string, unknown> = {};
  if (status) trusted.status = status;
  else {
    logger.info('Stripe subscription status has no equivalent here; status left alone', {
      companyId: current.companyId,
      stripeSubscriptionId: subscription.id,
      stripeStatus: subscription.status,
    });
  }

  if (!canceled) {
    // Only on `.updated`: a cancelled subscription's last period is over, and
    // `allowanceWindowFor` deliberately ignores a window that has ended.
    const periodStart = isoFromUnixSeconds(subscription.current_period_start);
    const periodEnd = isoFromUnixSeconds(subscription.current_period_end);
    if (periodStart && periodEnd) {
      trusted.current_period_start = periodStart;
      trusted.current_period_end = periodEnd;
    }
  }

  // A cancellation is not a package change. The status is what stops the
  // service; rewriting the limits on the way out would only make it harder to
  // see what the company had when they left.
  const resolution: PlanResolution | null = canceled
    ? null
    : await resolvePlanFromSubscription(subscription);

  const resolved = resolution?.outcome === 'resolved' ? resolution.plan : null;
  const planPatch = resolved ? { plan: resolved.key, ...limitsOf(resolved) } : null;
  if (resolved) {
    // Audited only when the package or one of its limits actually moves. Stripe
    // sends `customer.subscription.updated` for renewals, card changes and its
    // own housekeeping, and an entry per event would bury the one that matters —
    // this log is read by the company as well as by an operator.
    const packageMoved =
      resolved.key !== current.plan ||
      resolved.messageLimit !== current.messageLimit ||
      resolved.botLimit !== current.botLimit ||
      resolved.agentLimit !== current.agentLimit ||
      resolved.integrationLimit !== current.integrationLimit;
    if (packageMoved) {
      await recordBillingAudit(sb, {
        companyId: current.companyId,
        action: 'subscription.stripe_plan_changed',
        metadata: {
          plan: resolved.key,
          status: status ?? current.status,
          previousPlan: current.plan,
          previousStatus: current.status,
          previousLimits: limitsSnapshot(current),
          appliedLimits: limitsOf(resolved),
          stripeSubscriptionId: subscription.id,
        },
      });
    }
  } else if (resolution && resolution.outcome !== 'no_prices') {
    logger.error(
      'Stripe subscription price could not be resolved to one package; plan left alone',
      {
        companyId: current.companyId,
        stripeSubscriptionId: subscription.id,
        ...resolution,
      },
    );
    await recordBillingAudit(sb, {
      companyId: current.companyId,
      action: 'subscription.stripe_price_unresolved',
      metadata: {
        reason: resolution.outcome,
        plan: current.plan,
        status: status ?? current.status,
        stripeSubscriptionId: subscription.id,
        ...resolution,
      },
    });
  }

  /*
   * A package bought inside Stripe's portal needs its wallet funding for exactly
   * the reason a checkout does: the reply gate reads the wallet, not the plan
   * name, so a customer who upgrades Starter -> Pro here would otherwise hold
   * Pro's limits on Starter's £7 until the 1st — and the monthly job cannot fix
   * it, because this month's `included_credit` slot is already spent.
   *
   * ONLY WHEN THE PACKAGE KEY MOVES. Stripe sends `customer.subscription.updated`
   * for renewals, card changes and its own housekeeping, and the `packageMoved`
   * test used for the audit above also fires whenever a limit merely differs —
   * which is permanently true of any company an operator gave a bespoke limit.
   * Funding on that would refill those wallets on every passing event: a monthly
   * allowance handed out weekly. A changed key is the one signal that says a
   * different package is now being billed for.
   *
   * A DOWNGRADE IS SAFE and is deliberately not special-cased: the movement is
   * "up TO, never past", so a cheaper package computes a zero delta against a
   * wallet already above the smaller figure and takes nothing out of one below
   * it. What it must not do is grant to a company that has stopped paying, so
   * the status gate mirrors `replenishMonthlyCredit`'s — `past_due` and
   * `canceled` get nothing new.
   *
   * BEFORE THE WRITE, unlike the checkout path, and the ordering is the whole
   * reason this is here rather than at the bottom of the function. Funding can
   * fail, and a failure throws so Stripe redelivers — but the write below
   * replaces `current.plan` with the new key, so on that redelivery the "key
   * moved" test would be false and the wallet would never be funded at all. The
   * cost of the earlier position is that a package Stripe is billing for, whose
   * key this database then refuses (the rejection branch below), is funded
   * anyway: the customer is genuinely paying Stripe for it, so being credited
   * for what they bought is the right side to err on.
   */
  const appliedStatus = status ?? current.status;
  if (
    resolved &&
    resolved.key !== current.plan &&
    (appliedStatus === 'active' || appliedStatus === 'trialing')
  ) {
    await fundWalletForPurchase(sb, {
      companyId: current.companyId,
      plan: resolved,
      perCompanyIncludedCredit: current.includedCreditGbp,
      messageLimit: resolved.messageLimit,
      source: 'stripe_subscription_update',
      reference: subscription.id,
    });
  }

  // Nothing worth writing: an unmapped price on a status Stripe has no
  // equivalent for. An empty PostgREST update is an error, not a no-op.
  const patch = { ...trusted, ...(planPatch ?? {}) };
  if (Object.keys(patch).length === 0) return;

  let write = await sb
    .from('subscriptions')
    .update(patch)
    .eq('stripe_subscription_id', subscription.id)
    .select('company_id');

  /*
   * A package key the `plan` column will not store.
   *
   * `billing_plans` is edited inside the product and `stripe_price_mappings` may
   * point a Stripe price at any key in it, so a package an operator added after
   * launch can resolve perfectly here and still be rejected by the database —
   * as a 23514 while `subscriptions.plan` enumerated five keys (migration 0004),
   * or as a 23503 if the catalogue row is deleted between the read above and
   * this write (migration 0096 replaced the enumeration with a foreign key; see
   * that file for why).
   *
   * This used to rethrow, on the reasoning that a failed event Stripe retries
   * beats a silent no-op. The reasoning was right and the effect was not: the
   * rejection discards the WHOLE statement, so the status and the billing period
   * — neither of which needed the catalogue to be correct — were thrown away
   * with the package. Stripe then retried the same doomed write for about three
   * days and dropped the event for good, leaving a paying customer whose status
   * never moved and nobody told. So this is now the fourth way of failing to
   * resolve a package, handled like the other three: write what is trustworthy,
   * leave the package alone, and put the rejected key where an operator looks.
   *
   * Retrying without the package is also what proves the diagnosis. `trusted`
   * holds only a status this file mapped itself and two timestamps, so if the
   * second write succeeds the package really was the problem; if it fails too,
   * the error is thrown and Stripe retries, exactly as before.
   */
  if (resolved && isPlanColumnRejection(write.error)) {
    logger.error(
      'The subscriptions.plan column refused the package Stripe is billing for; the ' +
        'status was applied but the package and its limits were not. Add the package to ' +
        'the column (or fix the price mapping) — this customer is paying for one thing ' +
        'and holding another.',
      {
        companyId: current.companyId,
        stripeSubscriptionId: subscription.id,
        rejectedPlan: resolved.key,
        storedPlan: current.plan,
        databaseCode: write.error?.code ?? null,
        error: write.error?.message ?? null,
      },
    );
    await recordBillingAudit(sb, {
      companyId: current.companyId,
      // Deliberately the same action as the three resolution failures above: an
      // operator watching for "Stripe named a package we could not apply" has
      // one thing to watch for, and `reason` says which of the four it was.
      action: 'subscription.stripe_price_unresolved',
      metadata: {
        reason: 'plan_key_rejected',
        rejectedPlan: resolved.key,
        rejectedLimits: limitsOf(resolved),
        plan: current.plan,
        status: status ?? current.status,
        stripeSubscriptionId: subscription.id,
        databaseCode: write.error?.code ?? null,
        databaseError: write.error?.message ?? null,
      },
    });
    // The package was the only thing there was to write. Nothing left to retry,
    // and an empty PostgREST update is an error rather than a no-op.
    if (Object.keys(trusted).length === 0) return;
    write = await sb
      .from('subscriptions')
      .update(trusted)
      .eq('stripe_subscription_id', subscription.id)
      .select('company_id');
  }

  if (write.error) throw write.error;
  if (!write.data || write.data.length === 0) {
    logger.error('Stripe subscription update matched no row when writing', {
      companyId: current.companyId,
      stripeSubscriptionId: subscription.id,
    });
  }
}

// ---------------------------------------------------------------------------

async function handlePaymentFailed(sb: ServiceClient, invoice: Stripe.Invoice): Promise<void> {
  const customer = stripeIdOf(invoice.customer);
  if (!customer) return;
  const { data, error } = await sb
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_customer_id', customer)
    .select('company_id')
    .maybeSingle();
  if (error) throw error;
  if (!data?.company_id) {
    logger.warn('Stripe reported a failed payment for a customer this platform does not know', {
      stripeCustomerId: customer,
    });
    return;
  }
  await notify({
    companyId: data.company_id as string,
    type: 'failed_payment',
    title: 'Payment failed',
    body: 'Your latest subscription payment failed. Please update your payment method.',
    email: true,
  });
}

export async function POST(req: Request) {
  let event: Stripe.Event;
  try {
    event = await parseStripeEvent(req);
  } catch (err) {
    if (err instanceof StripeWebhookUnconfiguredError) {
      logger.error(
        'REFUSED a Stripe webhook: this deployment cannot verify signatures. Configure ' +
          'stripe.secret_key and stripe.webhook_secret in platform settings. Until then every ' +
          'billing event is being rejected and Stripe will retry them.',
        { error: err.message },
      );
      return new Response('stripe webhook not configured', { status: 503 });
    }
    logger.warn('Stripe webhook verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response('bad request', { status: 400 });
  }

  const sb = createSupabaseServiceClient();

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(sb, event.data.object);
    } else if (event.type === 'customer.subscription.updated') {
      await handleSubscriptionChanged(sb, event.data.object, false);
    } else if (event.type === 'customer.subscription.deleted') {
      await handleSubscriptionChanged(sb, event.data.object, true);
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(sb, event.data.object);
    }
  } catch (err) {
    // A 5xx, not the 200 this used to return. Everything above writes billing
    // state, and swallowing a failure told Stripe the event was handled — the
    // customer's package was then wrong until somebody noticed. Stripe retries a
    // 5xx with backoff, and each handler reads the row it changes before
    // changing it, so a retry re-applies the same end state rather than
    // compounding.
    logger.error('Stripe webhook error', {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response('webhook handler failed', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}
