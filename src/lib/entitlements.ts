import { cache } from 'react';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  PLAN_FEATURES,
  PLAN_FEATURE_DESCRIPTIONS,
  PLAN_FEATURE_LABELS,
  planFeatureEnabled,
  type PlanFeature,
  type PlanFeatureSet,
} from '@/modules/super-admin/plans';

/**
 * Feature entitlements — what a company's plan actually includes (migration 0065).
 *
 * Until now every plan granted every feature, so a Free Trial had the same
 * product as Pro and the price list described a difference the software did not
 * enforce. The rule is decided in two places and read here: the plan's own
 * `features` map in `src/modules/super-admin/plans.ts`, and the per-company
 * `subscriptions.feature_overrides` blob an operator sets when one customer is
 * an exception to their plan.
 *
 * THE ORDER, AND WHY IT ENDS IN "YES"
 * -----------------------------------
 * An override answers first, then the plan, then — for anything neither of them
 * mentions — allow. Falling back to allow is the whole design, not a shortcut:
 * this repository's plan list does not include the packages operators create in
 * the billing catalogue at runtime, and a gate that denied everything it did not
 * recognise would take features away from companies already paying for them the
 * moment someone added a plan. Leaking a feature costs revenue; revoking one
 * from a paying customer costs the customer. The same reasoning covers a failed
 * lookup: a database error here logs and grants, because a blip in the
 * subscriptions table must not read as "your plan was downgraded".
 *
 * TENANCY
 * -------
 * The service-role client bypasses row-level security, so the `company_id`
 * filter below is the isolation boundary. Callers pass the company id off the
 * session — never one taken from a request body — exactly as the rest of the
 * data layer does.
 */

/** Thrown by `requireFeature`. 402 is the same status the plan limits use. */
export class FeatureNotEntitledError extends AppError {
  readonly feature: PlanFeature;

  constructor(feature: PlanFeature) {
    super(
      `Your plan does not include ${PLAN_FEATURE_LABELS[feature]}.`,
      402,
      'feature_not_entitled',
      { feature },
    );
    this.name = 'FeatureNotEntitledError';
    this.feature = feature;
  }
}

export interface FeatureEntitlement {
  feature: PlanFeature;
  label: string;
  description: string;
  enabled: boolean;
  /** The operator's override decided this, against what the plan says. */
  overridden: boolean;
}

interface EntitlementSource {
  plan: string | null;
  overrides: PlanFeatureSet;
}

/**
 * Read whatever the operator wrote into a shape the rest of this file trusts.
 *
 * `feature_overrides` is hand-edited JSON, so it can hold a misspelled feature
 * name, a string `"false"`, or a key we retired two releases ago. Anything that
 * is not a boolean under a name in `PLAN_FEATURES` is dropped, which means the
 * worst a typo can do is leave the plan's own answer standing. Silently
 * granting is the safe direction here; silently denying is not.
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
 * The plan and its overrides, read once per request.
 *
 * `cache()` is React's per-request memo, the same mechanism `getSessionUser()`
 * uses in `src/lib/auth/index.ts`. It matters more here than it looks: a page
 * that checks four features in four places would otherwise pay four identical
 * round trips (~230 ms each on this deployment) for one row that cannot change
 * mid-render.
 */
const loadEntitlementSource = cache(async function loadEntitlementSource(
  companyId: string,
): Promise<EntitlementSource> {
  const { data, error } = await createSupabaseServiceClient()
    .from('subscriptions')
    .select('plan, feature_overrides')
    .eq('company_id', companyId) // the isolation boundary — see the note above
    .maybeSingle();

  if (error) {
    logger.error('Entitlement lookup failed; granting the feature', {
      companyId,
      error: error.message,
    });
    return { plan: null, overrides: {} };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    plan: (row.plan as string) ?? null,
    overrides: normalizeOverrides(row.feature_overrides),
  };
});

function resolve(source: EntitlementSource, feature: PlanFeature): boolean {
  const override = source.overrides[feature];
  return typeof override === 'boolean' ? override : planFeatureEnabled(source.plan, feature);
}

/** Is `feature` available to this company? */
export async function hasFeature(companyId: string, feature: PlanFeature): Promise<boolean> {
  return resolve(await loadEntitlementSource(companyId), feature);
}

/**
 * Same question, thrown instead of returned. Use it in server actions and route
 * handlers, where `handleApiError` already turns an `AppError` into the JSON the
 * client expects.
 */
export async function requireFeature(companyId: string, feature: PlanFeature): Promise<void> {
  if (!(await hasFeature(companyId, feature))) throw new FeatureNotEntitledError(feature);
}

/**
 * Every feature with its answer, for the screens that describe a plan rather
 * than gate on one. Built from the same single read, so what the billing page
 * prints and what a gate would decide can never disagree.
 */
export const listEntitlements = cache(async function listEntitlements(
  companyId: string,
): Promise<FeatureEntitlement[]> {
  const source = await loadEntitlementSource(companyId);
  return PLAN_FEATURES.map((feature) => {
    const enabled = resolve(source, feature);
    return {
      feature,
      label: PLAN_FEATURE_LABELS[feature],
      description: PLAN_FEATURE_DESCRIPTIONS[feature],
      enabled,
      overridden: enabled !== planFeatureEnabled(source.plan, feature),
    };
  });
});
