import { listBillingPlans, type BillingPlan } from '@/modules/super-admin/billing-data';
import { logger } from '@/lib/logger';
import {
  PLANS,
  PLAN_FEATURES,
  PLAN_FEATURE_DESCRIPTIONS,
  PLAN_FEATURE_LABELS,
  PLAN_KEYS,
  planFeatureEnabled,
  type PlanDef,
  type PlanFeature,
} from '@/modules/super-admin/plans';

/**
 * What the public pricing page is allowed to say a package costs.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * A pricing page that disagrees with the billing page is worse than no pricing
 * page: a stranger reads £19, signs up, and Stripe charges something else. So
 * nothing on the public page may be a retyped number. Every figure it renders
 * comes through here, and here reads the same two sources the product itself
 * charges from.
 *
 * WHICH SOURCE WINS, AND WHY IT IS NOT SIMPLY `plans.ts`
 * ------------------------------------------------------
 * There are two: `src/modules/super-admin/plans.ts`, the catalogue in code, and
 * the `billing_plans` table, which migration 0025 seeds from exactly those
 * numbers and which a super-admin can then edit inside the product. The
 * dashboard billing page reads the table (`listBillingPlans({ publicOnly:
 * true })`), and Stripe checkout refuses any package the table does not mark
 * public and active. So the table is what is actually sold, and reading only
 * the code catalogue would let this page keep advertising £19 the morning after
 * an operator changed it to £24 — the precise drift this page must not have.
 *
 * The table therefore decides prices, limits, and which packages appear.
 * `plans.ts` supplies what the table has no column for — the feature matrix —
 * and is the fallback for both when the read fails, which is the same set of
 * numbers the table was seeded with. Either way no price is typed into a
 * component.
 *
 * A DATABASE BLIP MUST NOT 500 A MARKETING PAGE
 * ---------------------------------------------
 * This page is anonymous, indexed, and the first thing a buyer sees. If
 * Supabase does not answer, it falls back to the code catalogue and says so in
 * `source` rather than throwing — a stale-but-seeded price beats an error page,
 * and `source` lets the page drop the checkout claim it can no longer stand
 * behind.
 */

/** One package as a stranger should see it. */
export interface PublicPlan {
  key: string;
  label: string;
  description: string;
  priceMonthlyGbp: number;
  /** AI replies included each month; `null` means unmetered. */
  monthlyReplies: number | null;
  assistants: number | null;
  seats: number | null;
  integrations: number | null;
  trialDays: number | null;
  features: PublicPlanFeature[];
}

export interface PublicPlanFeature {
  feature: PlanFeature;
  label: string;
  description: string;
  included: boolean;
}

export interface PublicPricing {
  /** Purchasable packages, in the order the catalogue sorts them. */
  plans: PublicPlan[];
  /** The quoted package, which is deliberately not for sale on a card. */
  custom: { label: string; description: string };
  /** Free-trial length in days, or `null` if no package offers one. */
  trialDays: number | null;
  /** Where the numbers above came from. `fallback` = the catalogue read failed. */
  source: 'catalogue' | 'fallback';
}

/**
 * VAT, in one sentence, in one place.
 *
 * This is a claim about money, so it is written from what the code does rather
 * than from what feels reasonable: `src/app/api/billing/checkout/route.ts` sends
 * Stripe a bare price id with no `automatic_tax` and no tax rate attached, and
 * nothing in the subscription webhook adds one afterwards. The amount on the
 * page is therefore the amount on the card, with nothing added at the till.
 *
 * The public pricing page and the dashboard billing page both import this
 * string, so the two cannot end up saying different things about tax. If Stripe
 * automatic tax is ever switched on, this sentence is the thing to change and
 * both pages change with it.
 */
export const VAT_STATEMENT =
  'All prices are in pounds and include VAT. The figure you see is the figure your card is charged — no seat fees, no per-conversation charges, and nothing added at checkout.';

/** The badge-sized form of the same fact, for sitting next to a price. */
export const VAT_SHORT = 'inc VAT';

/**
 * Where the data lives — stated because almost no competitor states it.
 *
 * True as of the Tokyo → London move: `NEXT_PUBLIC_SUPABASE_URL` points at the
 * London project (`aws-0-eu-west-2`) and the application server is in
 * Manchester. Both halves are named because "UK hosted" on its own is the kind
 * of claim every vendor makes and none of them evidences.
 */
export const HOSTING_STATEMENT =
  'Your account, your conversations and your business data are stored in the UK. The database runs in London (AWS eu-west-2) and the application server is in Manchester.';

/**
 * The part of the residency story that is inconvenient, said out loud.
 *
 * The AI reply itself is generated by a model we call at OpenAI or Anthropic
 * (see `src/lib/ai/registry.ts`), and those run outside the UK. A buyer who
 * cares about residency will find that out eventually; finding it out from us
 * first is worth more than the sentence costs.
 */
export const AI_RESIDENCY_STATEMENT =
  'The AI answer itself is generated by models we call at OpenAI and Anthropic, which run outside the UK — so the wording of a message leaves the country to be answered and comes straight back. We would rather tell you that here than leave you to find it in a sub-processor list.';

function toPublicPlan(key: string, row: BillingPlan | null, def: PlanDef | null): PublicPlan {
  // `??` is wrong for the limits: `null` is a real, meaningful value here
  // (unmetered), so falling through to the code catalogue on a legitimate
  // `null` would advertise a cap the customer does not actually have.
  const numbers = row
    ? {
        priceMonthlyGbp: row.priceMonthlyGbp,
        monthlyReplies: row.messageLimit,
        assistants: row.botLimit,
        seats: row.agentLimit,
        integrations: row.integrationLimit,
        trialDays: row.trialDays,
      }
    : {
        priceMonthlyGbp: def?.priceMonthly ?? 0,
        monthlyReplies: def?.messageLimit ?? null,
        assistants: def?.botLimit ?? null,
        seats: def?.agentLimit ?? null,
        integrations: def?.integrationLimit ?? null,
        trialDays: def?.trialDays ?? null,
      };

  return {
    key,
    label: row?.label ?? def?.label ?? key,
    description: row?.description || def?.description || '',
    ...numbers,
    // `planFeatureEnabled` is the same function the running product gates on,
    // so a package this file has never heard of — every one an operator creates
    // in the billing catalogue is one — is advertised exactly as permissive as
    // the software will actually be. The page cannot promise less, or more,
    // than the gate allows.
    features: PLAN_FEATURES.map((feature) => ({
      feature,
      label: PLAN_FEATURE_LABELS[feature],
      description: PLAN_FEATURE_DESCRIPTIONS[feature],
      included: planFeatureEnabled(key, feature),
    })),
  };
}

export async function getPublicPricing(): Promise<PublicPricing> {
  let live: BillingPlan[] | null = null;
  try {
    // Byte for byte the call the dashboard billing page makes. Anything that
    // would change what a customer is offered in there changes what a stranger
    // is quoted out here, in the same breath.
    live = await listBillingPlans({ publicOnly: true });
  } catch (error) {
    // Anonymous page, so there is no session to blame and nobody to show an
    // error to. Log it and sell the seeded prices.
    logger.warn('Public pricing fell back to the code catalogue', {
      error: error instanceof Error ? error.message : String(error),
    });
    live = null;
  }

  const plans: PublicPlan[] =
    live && live.length > 0
      ? live.map((row) =>
          toPublicPlan(row.key, row, row.key in PLANS ? PLANS[row.key as keyof typeof PLANS] : null),
        )
      : PLAN_KEYS.filter((key) => key !== 'custom').map((key) =>
          toPublicPlan(key, null, PLANS[key]),
        );

  // The longest trial any listed package offers, rather than a hardcoded 14 —
  // the trial length is a column an operator can edit like any other.
  const trials = plans.map((plan) => plan.trialDays).filter((days): days is number => days != null && days > 0);
  const trialDays = trials.length > 0 ? Math.max(...trials) : null;

  return {
    plans,
    // Never a card, and never a number: `custom` is marked non-public in the
    // catalogue precisely because it is negotiated one company at a time. All
    // the page takes from it is the sentence describing who it is for, so there
    // is no price here to drift from anything.
    custom: { label: PLANS.custom.label, description: PLANS.custom.description },
    trialDays,
    source: live ? 'catalogue' : 'fallback',
  };
}

/** `19` → `£19`. Whole pounds, because every package price is whole pounds. */
export function gbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** `2000` → `2,000`, and `null` → the word for no cap. */
export function count(value: number | null, unmetered = 'Unmetered'): string {
  return value == null ? unmetered : new Intl.NumberFormat('en-GB').format(value);
}
