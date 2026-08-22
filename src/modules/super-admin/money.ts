import { USD_TO_GBP } from '@/lib/billing/credits';

/**
 * Money helpers for the super-admin financial screens (Module 4).
 *
 * The platform books revenue in GBP (`billing_plans.price_monthly_gbp`) but the
 * AI providers invoice in USD (`ai_usage_logs.estimated_cost`). Every number
 * that mixes the two must be converted first, and every rendered figure must
 * carry its currency — that is what this module exists to enforce.
 *
 * The FX rate is NOT redefined here: it is imported from `@/lib/billing/credits`
 * so the operator-facing margin uses exactly the rate customers are charged at.
 */

export { USD_TO_GBP };

/** Convert an AI provider cost (USD) into the platform's reporting currency. */
export function usdToGbp(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) return 0;
  return amountUsd * USD_TO_GBP;
}

/**
 * GBP formatter. Two decimals by default — margins are revenue minus a
 * fractional AI cost, so rounding to whole pounds hides the number that matters.
 */
export function gbp(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * USD formatter for raw provider cost. Four decimals: a month of light usage is
 * routinely under a cent, and anything coarser renders it as `$0`.
 */
export function usd(value: number, fractionDigits = 4): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}
