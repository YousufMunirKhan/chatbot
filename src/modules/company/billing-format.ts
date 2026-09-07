/**
 * Shapes and formatters for billing data, with no server dependencies.
 *
 * Split out of `billing-stripe.ts` deliberately. That module reaches the
 * platform settings, which reach `@/lib/db/server`, which reaches
 * `next/headers` — importing any of it from a `'use client'` component breaks
 * the build. The card picker on the billing page is a client component and
 * needs to describe a card, so the pure half lives here where both sides can
 * have it.
 */

export interface CompanyInvoice {
  id: string;
  /** Stripe's human reference, e.g. `A1B2C3D4-0001`. Absent on drafts. */
  number: string | null;
  createdIso: string;
  status: string;
  /** Minor units, in `currency`. */
  total: number;
  currency: string;
  /** Stripe hosts both. We never render or store a document ourselves. */
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

export interface CompanyCard {
  /** The `pm_…` id. Never typed by a human — see billing-auto-topup-actions.ts. */
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /** The card Stripe would bill for the subscription itself. */
  isDefault: boolean;
}

/**
 * Currencies Stripe counts in whole units. Everything else is in the hundredth
 * — dividing a ¥12,300 invoice by 100 and printing ¥123 is the kind of wrong
 * that only shows up once a customer outside the UK is on the platform.
 */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/** A Stripe minor-unit amount, in the currency Stripe reported it in. */
export function formatStripeAmount(amount: number, currency: string): string {
  const code = (currency || 'gbp').toLowerCase();
  const zeroDecimal = ZERO_DECIMAL.has(code);
  const value = zeroDecimal ? amount : amount / 100;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code.toUpperCase(),
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
  } catch {
    // An unrecognised currency code would otherwise throw inside a render.
    return `${value.toFixed(zeroDecimal ? 0 : 2)} ${code.toUpperCase()}`;
  }
}

/** "Visa •••• 4242 · expires 04/2028" — what a person recognises as their card. */
export function describeCard(card: CompanyCard): string {
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  const expiry = `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`;
  return `${brand} •••• ${card.last4} · expires ${expiry}`;
}

/** True once the printed expiry month has fully passed. */
export function cardHasExpired(card: CompanyCard, now: Date = new Date()): boolean {
  if (!card.expYear || !card.expMonth) return false;
  const endOfExpiryMonth = new Date(Date.UTC(card.expYear, card.expMonth, 1));
  return now.getTime() >= endOfExpiryMonth.getTime();
}
