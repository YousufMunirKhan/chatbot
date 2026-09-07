import { createHmac, timingSafeEqual } from 'crypto';
import type { StoreProvider } from './automation-templates';

/**
 * Store webhook signature verification.
 *
 * Server-only (it needs `crypto`), which is why it is not in
 * `automation-templates.ts` — that module is imported by a client component.
 *
 * Shopify and WooCommerce use the same scheme, base64 HMAC-SHA256 over the RAW
 * request body, and differ only in the header they put it in. The body must be
 * the exact bytes received: parsing and re-serialising the JSON changes the
 * digest and every delivery would fail verification.
 */

export const STORE_SIGNATURE_HEADERS: Record<StoreProvider, string> = {
  shopify: 'x-shopify-hmac-sha256',
  woocommerce: 'x-wc-webhook-signature',
};

export function storeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

/**
 * Constant-time signature check.
 *
 * Returns false when no signature was presented. The CALLER decides what an
 * unconfigured secret means — the route rejects in production and warns in
 * development — rather than this function silently trusting an unsigned body.
 */
export function verifyStoreSignature(
  rawBody: string,
  provided: string | null,
  secret: string | null,
): boolean {
  if (!secret || !provided) return false;
  const expected = Buffer.from(storeSignature(rawBody, secret), 'utf8');
  const actual = Buffer.from(provided.trim(), 'utf8');
  // timingSafeEqual throws on a length mismatch, and the length of a base64
  // SHA-256 digest is public anyway.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
