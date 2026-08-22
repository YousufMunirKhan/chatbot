import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * Plan pricing lookup for the revenue screens (Module 4).
 *
 * There used to be two disagreeing revenue sources: the static `PLANS` constant
 * in `./plans` (whose own doc comment calls the prices placeholders) and
 * `billing_plans.price_monthly_gbp` in the database. **The database wins.**
 * `billing_plans` is what the Billing & Plans screen edits, what Stripe price
 * mappings hang off, and what the customer is actually charged — a placeholder
 * constant that no operator can change must never drive an MRR figure.
 *
 * `PLANS` is retained only for onboarding defaults (limits, included credit) and
 * for `planLabel()`; it is no longer consulted for money.
 *
 * This lives in its own module rather than in `./billing-data` because
 * `billing-data` imports `./data`, and `./data` needs prices — routing the
 * lookup through `billing-data` would create an import cycle.
 */
export async function getPlanPriceMapGbp(): Promise<Map<string, number>> {
  const { data, error } = await createSupabaseServiceClient()
    .from('billing_plans')
    .select('key,price_monthly_gbp');
  if (error) throw error;
  return new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => [
      row.key as string,
      Number(row.price_monthly_gbp ?? 0),
    ]),
  );
}
