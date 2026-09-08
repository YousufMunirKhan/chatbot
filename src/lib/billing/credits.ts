import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { MEASURED_COST_PER_REPLY_USD } from '@/lib/ai/model-policy';
import { PLANS, type PlanKey } from '@/modules/super-admin/plans';

/**
 * The provider-cost FX rate (USD invoices → GBP books) every wallet charge is
 * computed at.
 *
 * This comment used to call itself the single source of truth, and that was not
 * true: `src/lib/ai/model-policy.ts` declares its own `USD_TO_GBP` for the
 * platform settings page's margin table. `src/modules/super-admin/money.ts` does
 * re-export this one. Two copies of the rate means the number a customer is
 * charged and the number the owner reasons about can drift apart, so move them
 * together until the second copy is gone.
 */
export const USD_TO_GBP = 0.8;
const CUSTOMER_AI_MARKUP = 2.5;
const MIN_AI_CHARGE_GBP = 0.001;

function roundMoney(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function customerAiChargeGbp(providerCostUsd: number): number {
  if (!Number.isFinite(providerCostUsd) || providerCostUsd <= 0) return 0;
  return roundMoney(Math.max(MIN_AI_CHARGE_GBP, providerCostUsd * USD_TO_GBP * CUSTOMER_AI_MARKUP));
}

export async function getAiCreditAccess(companyId: string): Promise<{
  tracked: boolean;
  allowed: boolean;
  balance: number | null;
}> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('company_credit_accounts')
    .select('balance_amount')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    logger.warn('Failed to read AI credit access', { companyId, error: error.message });
    return { tracked: false, allowed: true, balance: null };
  }
  if (!data) return { tracked: false, allowed: true, balance: null };
  const balance = Number(data.balance_amount ?? 0);
  return { tracked: true, allowed: balance > 0, balance };
}

/** What `replenishMonthlyCredit` did, in wallet units (GBP). */
export interface CreditReplenishment {
  topped: boolean;
  from: number;
  to: number;
}

const REPLENISHABLE_STATUSES = new Set(['active', 'trialing']);

/**
 * What a package is funded with when nobody has said what it is worth AND there
 * is no reply allowance to size the answer from.
 *
 * `custom` is the package every comped and negotiated deal sits on, and until
 * migration 0093 it had nowhere to record the figure that was negotiated — so
 * `PLANS.custom.includedCreditGbp` is 0 and `billing_plans` seeds it as 0 too.
 * Nothing about that meant "this company gets no AI credit"; it meant "this is
 * settled elsewhere", and there was no elsewhere. Every funding path bails on a
 * zero, so a company comped to `custom` kept its unlimited reply allowance and
 * went permanently silent the moment its opening wallet ran dry. That is the
 * failure this whole change exists to remove, on the accounts that matter most.
 *
 * The figure is the largest included credit in the price list — funding a
 * negotiated deal like the biggest thing a card can buy is a floor, not a
 * ceiling, and an operator raises it by typing the real number into
 * `subscriptions.included_credit_gbp` on the super-admin plan form. Derived
 * rather than written down so it tracks the price list; the alternative answers
 * were zero (silence, the bug) and unlimited, which the wallet cannot represent.
 */
export const UNCAPPED_PLAN_CREDIT_FLOOR_GBP = Math.max(
  ...Object.values(PLANS).map((plan) => plan.includedCreditGbp),
);

/** The +15% the `PLANS` figures carry. Its reasoning is in that map's comment. */
const CREDIT_HEADROOM = 1.15;

/**
 * What one reply costs the WALLET on the dearest model we have measured.
 *
 * Derived from `MEASURED_COST_PER_REPLY_USD` — the same 89-reply measurement the
 * `PLANS` figures were computed from — rather than written down again here, so a
 * re-measurement moves this with it. The dearest model and not the average one,
 * for the reason step 3 of that map's derivation gives: a package that may
 * escalate has to be funded as if every question were hard, and a package this
 * code has never heard of may escalate — `planFeatureEnabled` grants
 * `premium_model` to any key it does not recognise, which is every package an
 * operator creates in the billing catalogue.
 */
function dearestReplyChargeGbp(): number {
  const measured = Object.values(MEASURED_COST_PER_REPLY_USD).filter(
    (usd) => Number.isFinite(usd) && usd > 0,
  );
  return measured.length > 0 ? customerAiChargeGbp(Math.max(...measured)) : 0;
}

/**
 * The backstop figure for a package that sells replies and names no credit.
 *
 * Sized exactly the way the `PLANS` figures were derived — allowance x the
 * customer's per-reply charge on the dearest tier, +15%, rounded up to the pound
 * — so it reproduces them: 2,000 replies gives £97 and 5,000 gives £242, which
 * are Business and Pro to the penny. That is the point of doing it this way
 * rather than picking a number: an operator who builds a package in the billing
 * catalogue that looks like Pro gets Pro's wallet without having to know that a
 * wallet exists.
 *
 * Nothing clamps the result from above. A wallet sized from an allowance can
 * only be reached by serving the replies that allowance sold, so a ceiling here
 * would put back exactly what this whole change removes — a wallet that stops
 * the assistant before the product limit does. An operator who wants to spend
 * less than the allowance implies types the real figure into
 * `subscriptions.included_credit_gbp`, which outranks this.
 *
 * With no allowance to size from — an unlimited package, or a nonsensical limit
 * — there is nothing to compute, so the floor above answers instead.
 */
export function creditForReplyAllowance(messageLimit: number | null): number {
  const limit = messageLimit == null ? Number.NaN : Number(messageLimit);
  if (!Number.isFinite(limit) || limit <= 0) return UNCAPPED_PLAN_CREDIT_FLOOR_GBP;
  const perReply = dearestReplyChargeGbp();
  if (perReply <= 0) return UNCAPPED_PLAN_CREDIT_FLOOR_GBP;
  // Rounded UP to the pound, as the `PLANS` figures are. That is also what keeps
  // a package selling a handful of replies out of the zero this function exists
  // to avoid: any positive allowance ceilings to at least £1.
  return Math.ceil(limit * perReply * CREDIT_HEADROOM);
}

/** Where an included-credit figure can come from, most specific first. */
export interface IncludedCreditSources {
  /** `subscriptions.included_credit_gbp` — this company's own figure, or null. */
  perCompany: number | null;
  /** `billing_plans.included_credit_gbp` for the row's plan, or null. */
  catalogue: number | null;
  /** The static `PLANS` map's figure for the same key, if it knows the key. */
  mapped: number | undefined;
  /**
   * The company's resolved reply cap. When no source above names a figure this
   * is what the backstop is sized from; `null` (unlimited) reaches the floor.
   */
  messageLimit: number | null;
}

/**
 * The included credit this company is worth this month.
 *
 * PRECEDENCE, and why each step is where it is:
 *
 *  1. the company's own `subscriptions.included_credit_gbp` (migration 0093).
 *     Every other plan limit is already overridable per company with the plan
 *     supplying the default; this is the fifth number of that kind, and it is
 *     the only place a negotiated deal can be written down. A stored `0` is a
 *     real decision — "this company gets no AI credit" — and is honoured.
 *  2. `billing_plans`, because the catalogue is edited inside the product: an
 *     operator who raises a package's included credit on the plans screen
 *     expects the next month's top-up to honour it.
 *  3. the `PLANS` map, for a key the catalogue has lost, so a database that
 *     disagrees with the code still tops up something sane instead of nothing.
 *  4. a figure sized from the package's own reply allowance, and the floor when
 *     there is no allowance to size from. See `creditForReplyAllowance`.
 *
 * A ZERO IS ONLY AN ANSWER IN STEP 1
 * ----------------------------------
 * Steps 2 and 3 treat a zero as an unanswered question and fall through; step 1
 * does not, because there a zero was typed by a person about this one company
 * and "this company gets no AI credit" is a decision an operator is allowed to
 * take. A zero in `billing_plans` or the `PLANS` map is the opposite: it is
 * where the seed data starts, so it says nobody has been asked yet. A package
 * that sells replies it cannot fund is mis-configured, and honouring its zero
 * reproduces the original defect — the assistant going silent on a paying
 * customer who still has replies left.
 *
 * Step 4 used to fire only when the reply cap was `null`, and that condition was
 * wrong in both of the cases that matter. Comping a company to `custom` while
 * typing a reply limit into the same form resolved to £0, so the comp funded
 * nothing; and every package an operator creates in the billing catalogue is
 * seeded with `included_credit_gbp = 0` and a reply limit, so it did the same.
 * The cap is not what decides whether a wallet was deliberately set — who set it
 * is. So the resolution no longer looks at the cap to decide THAT, only to
 * decide what a sensible figure is.
 *
 * Exported because `updateSubscriptionAction` in the super-admin module has to
 * resolve the same figure to fund a comped wallet, and the two disagreeing about
 * which source wins is how a company is granted one thing and funded another.
 */
export function resolveIncludedCredit(sources: IncludedCreditSources): number {
  if (sources.perCompany != null && Number.isFinite(sources.perCompany)) {
    return Math.max(0, sources.perCompany);
  }
  const catalogue = Number(sources.catalogue ?? Number.NaN);
  if (Number.isFinite(catalogue) && catalogue > 0) return catalogue;
  const mapped = sources.mapped ?? 0;
  if (mapped > 0) return mapped;
  return creditForReplyAllowance(sources.messageLimit);
}

/** Resolve the figure for one company, reading the catalogue row it needs. */
async function includedCreditForSubscription(sub: {
  plan: string | null;
  includedCreditGbp: number | null;
  messageLimit: number | null;
}): Promise<number> {
  if (!sub.plan) return 0;
  const { data } = await createSupabaseServiceClient()
    .from('billing_plans')
    .select('included_credit_gbp')
    .eq('key', sub.plan)
    .maybeSingle();
  return resolveIncludedCredit({
    perCompany: sub.includedCreditGbp,
    catalogue: data ? Number(data.included_credit_gbp ?? 0) : null,
    mapped: sub.plan in PLANS ? PLANS[sub.plan as PlanKey].includedCreditGbp : undefined,
    messageLimit: sub.messageLimit,
  });
}

/** What `apply_credit_movement` (migration 0093) did. */
export interface CreditMovement {
  /**
   * `no_account` — credit is not tracked for this company, nothing to move.
   * `no_change` — the movement worked out to zero, so no ledger row was written:
   *               a top-up TO a figure the wallet already holds or exceeds, or a
   *               delta that rounded away. Not a failure.
   * `duplicate` — 0089's one-grant-per-month index refused it; the lock working.
   * `failed`    — the call itself did not complete; `error` says why.
   */
  status: 'applied' | 'no_account' | 'no_change' | 'duplicate' | 'failed';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  error?: string;
}

/**
 * Move a wallet balance and write its ledger row, atomically.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Every caller here used to read `balance_amount`, do the arithmetic in
 * JavaScript, and write the result back absolutely. That loses any write landing
 * between the read and the write. The cheap loss is a deduction — a penny. The
 * expensive one is a CREDIT: an auto or Stripe top-up arriving in that gap was
 * overwritten by the replenishment's `balance_amount = included`, taking the
 * customer's purchased money with it while the `top_up` ledger row survived to
 * claim it had been added. Guarding the update with `balance_amount < included`
 * does not help, because the ledger row is written first and would then assert a
 * grant that never landed. The row lock and the arithmetic have to be in the
 * same statement as the ledger row, which means they have to be in SQL.
 *
 * Returns rather than throws so the super-admin path can report a half-applied
 * movement to the operator in its own words; the reply path turns `failed` into
 * a throw at its call site, which is what its caller already expects.
 */
export async function applyCreditMovement(params: {
  companyId: string;
  type: string;
  /** A signed delta. Negative charges the wallet. Mutually exclusive with `toBalance`. */
  amount?: number;
  /** Top up TO this figure, never past it and never down to it. */
  toBalance?: number;
  description: string;
  metadata?: Record<string, unknown>;
  providerCostUsd?: number;
  aiUsageLogId?: string | null;
  createdBy?: string | null;
}): Promise<CreditMovement> {
  const sb = createSupabaseServiceClient();
  // The service-role client bypasses RLS, and the function is granted to
  // `service_role` alone, so this company_id IS the tenant boundary. It comes
  // from a session or a job, never from a request body.
  const { data, error } = await sb.rpc('apply_credit_movement', {
    p_company_id: params.companyId,
    p_type: params.type,
    p_amount: params.amount ?? null,
    p_target_balance: params.toBalance ?? null,
    p_description: params.description,
    p_metadata: params.metadata ?? {},
    p_provider_cost_usd: params.providerCostUsd ?? null,
    p_ai_usage_log_id: params.aiUsageLogId ?? null,
    p_created_by: params.createdBy ?? null,
  });
  if (error) {
    return { status: 'failed', amount: 0, balanceBefore: 0, balanceAfter: 0, error: error.message };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) {
    return {
      status: 'failed',
      amount: 0,
      balanceBefore: 0,
      balanceAfter: 0,
      error: 'the wallet function returned nothing',
    };
  }
  return {
    status: (row.status as CreditMovement['status']) ?? 'failed',
    amount: roundMoney(Number(row.amount_applied ?? 0)),
    balanceBefore: roundMoney(Number(row.balance_before ?? 0)),
    balanceAfter: roundMoney(Number(row.balance_after ?? 0)),
  };
}

/**
 * Refill a company's AI wallet to its plan's included credit, once a month.
 *
 * WHAT THIS FIXES
 * ---------------
 * Included credit was granted exactly once, at provisioning
 * (`src/modules/onboarding/provision.ts`), and every AI reply deducts from it
 * (`deductAiCreditForUsage`, below). Nothing ever put money back. So the third
 * of the three gates in `checkReplyGates` (`src/lib/ai/inbound.ts`, which the
 * widget and every messaging channel now go through) — `getAiCreditAccess`,
 * which requires a balance above zero — closed permanently as soon as the
 * opening credit ran out, and from month two the assistant was dead no matter
 * how many replies the customer was paying for. Starter was the clearest case:
 * it shipped £5 of opening credit against 500 advertised replies costing
 * ~£0.0121 each, so it funded about 412 of them, once, ever. The plan sold a
 * reply count its credit could not fund. Starter's figure is £7 now — the whole
 * price list was resized in the same change, see the `PLANS` map's comment.
 *
 * TOP UP TO, NOT BY
 * -----------------
 * The balance is raised TO the included figure, never increased by it. A
 * customer who bought a top-up and has not spent it keeps every penny of it and
 * gets nothing extra; a customer who has burned through the month keeps the
 * allowance they pay for. Adding on top would let an idle account accumulate
 * credit month after month and then spend a year of it in a weekend, which is
 * the shape of the loss this whole ledger exists to prevent.
 *
 * "TO" used to be implemented as `balance_amount = included`, computed from a
 * balance read a moment earlier. That destroyed any credit that landed in the
 * gap — a purchased top-up, overwritten, with its `top_up` ledger row left
 * behind claiming the money was added. The whole movement is one SQL statement
 * now (`apply_credit_movement`, migration 0093), which derives the top-up from
 * the row it is holding, so there is no gap to lose anything in.
 *
 * WHY THE LEDGER ROW IS THE LOCK
 * ------------------------------
 * Idempotency is the entire safety property here: this is money, and it is safe
 * to call from anywhere — a cron, a request path, a support script — precisely
 * because a second call in the same month does nothing. The lock is the
 * `included_credit` row in `company_credit_transactions`, not a boolean column
 * on the account, because a flag cannot survive a restore: replaying a backup or
 * re-running provisioning resets a flag and the money is granted twice, while
 * the ledger row comes back with the balance it explains. The ledger and the
 * balance are restored together or not at all.
 *
 * Migration 0089 makes that lock real with a unique index over
 * (company_id, UTC month) for this row type, so two workers racing on the 1st
 * cannot both grant: the loser's insert fails with 23505, which
 * `apply_credit_movement` reports back as `duplicate` — and because the insert
 * and the balance are one statement now, the loser's balance write is rolled
 * back with it rather than landing anyway. The month is the UTC calendar month rather than the subscription
 * period because a uniqueness constraint can only be expressed over the row
 * itself, and `created_at` carries a calendar month while a per-company Stripe
 * window does not. Topping up TO the included figure makes the two windows
 * drifting apart harmless — the wallet is never short for longer than a month.
 *
 * WHO DOES NOT GET IT
 * -------------------
 * Fresh credit is a thing of value, so a company that has stopped paying —
 * suspended, cancelled, or past due — is not given more. Nothing is confiscated:
 * whatever balance they hold is untouched. An expired trial is excluded for the
 * same reason, otherwise a trial nobody converted quietly draws its included
 * credit every month forever.
 */
export async function replenishMonthlyCredit(companyId: string): Promise<CreditReplenishment> {
  const sb = createSupabaseServiceClient();

  // The service-role client bypasses RLS, so this filter is the tenant
  // boundary. `companyId` comes from the session or a job, never a request body.
  const { data: account, error: accountError } = await sb
    .from('company_credit_accounts')
    .select('balance_amount')
    .eq('company_id', companyId)
    .maybeSingle();

  if (accountError) {
    logger.warn('Credit replenishment could not read the wallet', {
      companyId,
      module: 'billing.credits',
      error: accountError.message,
    });
    return { topped: false, from: 0, to: 0 };
  }
  // No wallet row means credit is not tracked for this company at all
  // (`getAiCreditAccess` lets those through), so there is nothing to refill.
  if (!account) return { topped: false, from: 0, to: 0 };

  // Read only to skip the work when there is obviously none to do, and to
  // describe a no-op. Nothing is COMPUTED from it: the figures that end up in
  // the ledger come back from `apply_credit_movement`, which reads the balance
  // under a row lock.
  const balance = roundMoney(Number(account.balance_amount ?? 0));
  const unchanged: CreditReplenishment = { topped: false, from: balance, to: balance };

  const { data: sub, error: subError } = await sb
    .from('subscriptions')
    .select('plan,status,trial_ends_at,message_limit,included_credit_gbp')
    .eq('company_id', companyId)
    .maybeSingle();
  if (subError || !sub) return unchanged;

  const status = (sub.status as string) ?? '';
  if (!REPLENISHABLE_STATUSES.has(status)) return unchanged;
  const trialEndsAt = (sub.trial_ends_at as string) ?? null;
  if (status === 'trialing' && trialEndsAt && Date.parse(trialEndsAt) < Date.now())
    return unchanged;

  // A package nobody has priced a wallet for — `custom`, and every package an
  // operator builds in the catalogue, both seeded at zero — reaches a real
  // figure through `resolveIncludedCredit` rather than the zero it holds, so a
  // comped or bespoke company is replenished like everyone else instead of being
  // the one shape of account this job silently skips.
  const included = roundMoney(
    await includedCreditForSubscription({
      plan: (sub.plan as string) ?? null,
      includedCreditGbp: sub.included_credit_gbp == null ? null : Number(sub.included_credit_gbp),
      messageLimit: sub.message_limit == null ? null : Number(sub.message_limit),
    }),
  );
  if (included <= 0 || balance >= included) return unchanged;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: already, error: alreadyError } = await sb
    .from('company_credit_transactions')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', 'included_credit')
    .gte('created_at', monthStart.toISOString())
    .limit(1);
  // A failed read fails CLOSED. Not granting is a support ticket; granting twice
  // because a query blipped is money, and money does not come back.
  if (alreadyError) {
    logger.warn('Credit replenishment could not check this month for a grant', {
      companyId,
      module: 'billing.credits',
      error: alreadyError.message,
    });
    return unchanged;
  }
  if (already && already.length > 0) return unchanged;

  // Ledger row and balance in one statement, under a row lock. `duplicate` is
  // 0089's unique index refusing a second grant this month — another worker won
  // the race between the check above and this call, which is the lock working
  // rather than a failure. `no_change` means the wallet is already above the
  // included figure, and nothing was written.
  const movement = await applyCreditMovement({
    companyId,
    type: 'included_credit',
    toBalance: included,
    description: `Monthly included AI credit (topped up to £${included.toFixed(2)})`,
    metadata: {
      plan: (sub.plan as string) ?? null,
      includedCreditGbp: included,
      period: monthStart.toISOString().slice(0, 7),
    },
  });
  if (movement.status === 'failed') throw new Error(movement.error ?? 'wallet movement failed');
  if (movement.status !== 'applied') return unchanged;

  logger.info('Included AI credit replenished', {
    companyId,
    module: 'billing.credits',
    plan: (sub.plan as string) ?? undefined,
    from: movement.balanceBefore,
    to: movement.balanceAfter,
  });

  return { topped: true, from: movement.balanceBefore, to: movement.balanceAfter };
}

export async function deductAiCreditForUsage(params: {
  companyId: string;
  aiUsageLogId: string | null;
  providerCostUsd: number;
  operationType: string;
  model: string;
}): Promise<void> {
  const charge = customerAiChargeGbp(params.providerCostUsd);
  if (charge <= 0) return;

  // This runs once per reply, on the hot path, so two replies answered at the
  // same moment used to read the same balance and write back two results that
  // each ignored the other — one of the deductions simply vanished, and the
  // busier the account the more of them did. The subtraction happens inside
  // `apply_credit_movement` now, under the same row lock as its ledger row.
  // Same signature and same throw-on-failure contract as before, so no caller
  // changed: `logAiUsage` still catches and warns rather than failing a reply.
  const movement = await applyCreditMovement({
    companyId: params.companyId,
    type: 'ai_usage',
    amount: -charge,
    description: `AI ${params.operationType} usage`,
    providerCostUsd: roundMoney(params.providerCostUsd, 6),
    aiUsageLogId: params.aiUsageLogId,
    metadata: {
      model: params.model,
      customerMarkup: CUSTOMER_AI_MARKUP,
      usdToGbp: USD_TO_GBP,
    },
  });
  if (movement.status === 'failed') {
    throw new Error(movement.error ?? 'AI credit could not be deducted');
  }
}
