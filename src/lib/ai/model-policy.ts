import { cache } from 'react';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { chatProviderById } from '@/lib/ai/registry';
import {
  PLAN_FEATURES,
  planModelTier,
  type ModelTier,
  type PlanFeatureSet,
} from '@/modules/super-admin/plans';

/**
 * Model policy — which AI model a company's plan is allowed to be answered on.
 *
 * WHAT THIS FIXES
 * ---------------
 * The chat model was one platform-wide setting: `getChatProviderAsync()` read
 * `ai.chat_model` and every company on every plan got whatever it said. Measured
 * across 89 production replies, Claude Sonnet costs $0.02100 a reply against
 * Claude Haiku's $0.00606 — 3.5x. At the plan allowances that is £84 of a £99
 * Pro subscription instead of £24, and £8.40 of a £19 Starter instead of £2.42.
 * Two companies answered on the premium tier erase the profit of eight on the
 * standard one, and until now nothing in the code could tell the difference.
 *
 * So the model is no longer a single global fact. It is the platform's setting
 * CLAMPED to the tier the company's plan may reach.
 *
 * WHERE THE ANSWER COMES FROM
 * ---------------------------
 * The same two places every other entitlement comes from, in the same order:
 * the per-company exception in `subscriptions.feature_overrides` (migration
 * 0065) first, then the plan's own `features` map in
 * `src/modules/super-admin/plans.ts`. Both are the `premium_model` flag, so the
 * operator control that already exists on the subscription form grants and
 * revokes the expensive model with no new screen, no new column and no second
 * override mechanism to keep in step with the first.
 *
 * WHY THIS FILE READS THE ROW ITSELF INSTEAD OF CALLING `hasFeature`
 * -----------------------------------------------------------------
 * `src/lib/entitlements.ts` answers the same question against the same two
 * sources, and deliberately GRANTS when it cannot answer: a database blip must
 * not read to a customer as "your plan was downgraded", and leaking a screen for
 * a few seconds costs nothing. Money runs the other way. An unresolvable lookup
 * that grants the premium tier bills 3.5x on every reply until somebody notices,
 * and nobody notices a cost — so here an unresolvable lookup resolves to
 * `standard`. That difference in direction is the entire reason this is not a
 * one-line call into that file, and it is why the two must not be merged.
 *
 * FAILING OPEN
 * ------------
 * "Open" here means the company still gets an answer, not that it gets the
 * expensive model. Every path through this file returns a usable model: a
 * missing subscription, a failed query, a plan nobody recognises and a model the
 * classifier has never seen all end with a real model id and a log line.
 * Refusing to reply because a pricing lookup failed would be a far worse failure
 * than replying on the cheaper model.
 *
 * TENANCY
 * -------
 * The service-role client bypasses row-level security, so the `company_id`
 * filter below is the isolation boundary. Callers pass the company id from the
 * bot or the session — never from a request body.
 */

/** Where a tier decision came from, for the log line and for the UI. */
export type ModelTierSource =
  | 'override' // an operator exception on this company's subscription
  | 'plan' // the plan's own `features` map
  | 'no_company' // platform-level call, nothing to clamp against
  | 'unresolved' // no subscription row, or the lookup failed
  | 'not_checked'; // the configured model was never expensive — nothing to ask

export interface TierDecision {
  tier: ModelTier;
  source: ModelTierSource;
}

export interface ModelDecision {
  /** The model to actually call. Always a usable id. */
  model: string;
  /** The tier that model sits in. */
  tier: ModelTier;
  /**
   * The ceiling this company is allowed, or null when the question was never
   * asked because the configured model was already the cheap one.
   */
  allowedTier: ModelTier | null;
  /** True when the platform's choice was too expensive and was replaced. */
  clamped: boolean;
  source: ModelTierSource;
}

/**
 * Cheap-tier markers, checked BEFORE the expensive ones because they are
 * substrings of them: `gpt-4o-mini` contains `gpt-4o`, and reading the family
 * name first would price the mini model as if it were the full one.
 */
const STANDARD_MARKERS: RegExp[] = [
  // Word-bounded, because "gemini" ends in "mini": a bare /mini/ priced every
  // Gemini Pro model as if it were a mini one, which is the expensive direction
  // to be wrong in. `-mini` and `_mini` suffixes still match.
  /\bmini\b/i,
  /haiku/i,
  /flash/i,
  /\blite\b|-lite/i,
  /gpt-3\.5/i,
  /deepseek-chat/i,
  /^mock$/i,
];

/**
 * The families that cost premium money. Matched by name rather than by an
 * exhaustive id list so a model released after this deploy — `claude-opus-4-9`,
 * a later Sonnet — is priced correctly the day an operator selects it, instead
 * of slipping through as "unknown" and billing a Starter plan for it.
 */
const PREMIUM_MARKERS: RegExp[] = [
  /opus/i,
  /sonnet/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /^o[1-9]/i,
  /gemini-[\d.]+-pro/i,
  /grok-4/i,
  /deepseek-reasoner/i,
];

/**
 * Which tier a model id belongs to.
 *
 * Anything that matches neither list is `standard`, which is to say "not known
 * to be expensive". That is the safe direction for a classifier that decides
 * whether to substitute a model: an unrecognised id an operator has chosen
 * deliberately keeps working exactly as they configured it, and the only thing
 * we decline to do is treat it as a reason to downgrade somebody. The cost of
 * being wrong is that an unrecognised expensive model is not clamped — add its
 * family to `PREMIUM_MARKERS` when one appears.
 */
export function classifyModel(model: string): ModelTier {
  const id = (model ?? '').trim();
  if (!id) return 'standard';
  if (STANDARD_MARKERS.some((re) => re.test(id))) return 'standard';
  if (PREMIUM_MARKERS.some((re) => re.test(id))) return 'premium';
  return 'standard';
}

/** The cheap model to fall back to for a provider, straight off the registry. */
export function standardModelFor(providerId: string): string | null {
  return chatProviderById(providerId)?.defaultChat ?? null;
}

/**
 * Measured cost per reply, in US dollars, from 89 real production replies.
 *
 * Only models we have actually measured appear here. An estimate invented for
 * the rest would be indistinguishable from a measurement on the screen that
 * renders it, and the whole point of this table is that somebody trusts the
 * number enough to change a price with it.
 */
export const MEASURED_COST_PER_REPLY_USD: Record<string, number> = {
  'claude-haiku-4-5-20251001': 0.00606,
  'claude-sonnet-4-6': 0.021,
};

/**
 * The rate the £ figures on the settings page are converted at. A constant, not
 * a live rate: this is a planning number for a pricing decision, and a margin
 * that moves every time the page is refreshed cannot be reasoned about. Edit it
 * when it drifts far enough to matter.
 */
export const USD_TO_GBP = 0.8;

/** What a plan's full monthly allowance costs on `model`, or null if unmeasured. */
export function estimatedMonthlyCostGbp(model: string, replies: number | null): number | null {
  const usd = MEASURED_COST_PER_REPLY_USD[model];
  if (usd == null || replies == null) return null;
  return usd * replies * USD_TO_GBP;
}

/**
 * The operator's exception, reduced to the entries we understand.
 *
 * Same rules as `normalizeOverrides` in `src/lib/entitlements.ts`, on purpose:
 * `feature_overrides` has been hand-edited with SQL, so it can hold a
 * misspelled name or a string `"true"`, and anything that is not a boolean under
 * a known feature name is dropped rather than guessed at.
 */
function normalizeOverrides(value: unknown): PlanFeatureSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const overrides: PlanFeatureSet = {};
  for (const feature of PLAN_FEATURES) {
    const entry = raw[feature];
    if (typeof entry === 'boolean') overrides[feature] = entry;
  }
  return overrides;
}

/**
 * The tier this company may reach, read once per request.
 *
 * `cache()` is React's per-request memo, the same one `getSessionUser()` and the
 * entitlement loader use. It matters here because a single chat turn asks for a
 * model more than once — the reply itself, and the escalation check for a hard
 * question — and that is one row that cannot change mid-request.
 */
export const allowedModelTier = cache(async function allowedModelTier(
  companyId: string | null | undefined,
): Promise<TierDecision> {
  // A platform-level call — the super admin's own "test AI settings", a
  // maintenance job — has no company to bill and nothing to clamp against, so
  // the configured model stands exactly as the operator chose it.
  if (!companyId) return { tier: 'premium', source: 'no_company' };

  const { data, error } = await createSupabaseServiceClient()
    .from('subscriptions')
    .select('plan, feature_overrides')
    .eq('company_id', companyId) // the isolation boundary — see the note above
    .maybeSingle();

  if (error) {
    logger.warn('Model tier lookup failed; answering on the standard model', {
      companyId,
      module: 'ai.model-policy',
      error: error.message,
    });
    return { tier: 'standard', source: 'unresolved' };
  }

  if (!data) {
    // No subscription row at all. Every real customer has one, so this is a
    // half-provisioned company rather than a plan decision — answer it, on the
    // model that cannot cost anybody £84 a month.
    logger.warn('No subscription for company; answering on the standard model', {
      companyId,
      module: 'ai.model-policy',
    });
    return { tier: 'standard', source: 'unresolved' };
  }

  const row = data as Record<string, unknown>;
  const override = normalizeOverrides(row.feature_overrides).premium_model;
  if (typeof override === 'boolean') {
    return { tier: override ? 'premium' : 'standard', source: 'override' };
  }
  return { tier: planModelTier((row.plan as string) ?? null), source: 'plan' };
});

/**
 * May this company be answered on the premium tier?
 *
 * The question the hard-question escalation in the chat route asks. It is the
 * same lookup the resolver uses, memoised on the same request, so the two can
 * never disagree about one company mid-turn.
 */
export async function companyAllowsPremiumModel(
  companyId: string | null | undefined,
): Promise<boolean> {
  return (await allowedModelTier(companyId)).tier === 'premium';
}

export interface ModelPolicyInput {
  companyId: string | null | undefined;
  /** The model the platform setting asks for. */
  requestedModel: string;
  /** The cheap model to use instead when the plan will not reach that far. */
  standardModel: string;
}

/**
 * The platform's chosen model, clamped to what this company's plan allows.
 *
 * The only branch that changes anything is "the plan may not have this model":
 * a company whose plan reaches the premium tier gets precisely what the operator
 * configured, and so does a company whose configured model was never expensive
 * in the first place.
 */
export async function resolveModelForCompany(input: ModelPolicyInput): Promise<ModelDecision> {
  const requestedTier = classifyModel(input.requestedModel);

  // Nothing to decide, and — the reason this branch comes first — nothing to
  // ask the database. A round trip on this deployment costs about 229 ms in
  // front of the first token, and when the platform is configured on a cheap
  // model that is every reply the product sends, spent to confirm a company is
  // allowed something it was never being given.
  if (requestedTier !== 'premium') {
    return {
      model: input.requestedModel,
      tier: requestedTier,
      allowedTier: null,
      clamped: false,
      source: 'not_checked',
    };
  }

  const { tier: allowedTier, source } = await allowedModelTier(input.companyId);

  if (allowedTier === 'premium') {
    return {
      model: input.requestedModel,
      tier: requestedTier,
      allowedTier,
      clamped: false,
      source,
    };
  }

  // The substitute has to be real, and it has to be cheaper. An empty registry
  // default, or one that is itself a premium model, would turn a cost decision
  // into a broken reply — so say so loudly and let the configured model stand.
  const fallback = input.standardModel?.trim();
  if (!fallback || classifyModel(fallback) === 'premium') {
    logger.error('No standard model to clamp to; leaving the premium model in place', {
      companyId: input.companyId ?? undefined,
      module: 'ai.model-policy',
      requestedModel: input.requestedModel,
      standardModel: fallback || null,
    });
    return {
      model: input.requestedModel,
      tier: requestedTier,
      allowedTier,
      clamped: false,
      source,
    };
  }

  logger.info('Model clamped to the plan tier', {
    companyId: input.companyId ?? undefined,
    module: 'ai.model-policy',
    requestedModel: input.requestedModel,
    model: fallback,
    allowedTier,
    source,
  });

  return {
    model: fallback,
    tier: classifyModel(fallback),
    allowedTier,
    clamped: true,
    source,
  };
}
