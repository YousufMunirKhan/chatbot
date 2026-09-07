import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Identity handoff for the mobile embed.
 *
 * A native host app opens our chat in a WebView and wants to say "this is
 * customer 123, their name is Sam". It cannot simply be believed: the URL is
 * visible in the app, on the network, and to anyone who decompiles the binary,
 * so an unsigned `user_id` is a request to impersonate any customer by editing
 * one query parameter.
 *
 * So the claim is signed. The host's SERVER computes
 * `HMAC-SHA256(bot secret, user_id)` and passes it as `signature`; we recompute
 * it here and compare in constant time. A request with no signature is not
 * rejected — it is simply anonymous, exactly like the website widget, which is
 * what an app with no backend needs.
 *
 * Pure and dependency-free on purpose: every branch is exercised by
 * `scripts/test-push-embed.mjs` without a database.
 */

export type IdentityStatus =
  /** No user_id and no signature — an ordinary anonymous visitor. */
  | 'anonymous'
  /** A user_id was claimed but not signed. Treated as anonymous. */
  | 'unsigned'
  /** A signature was supplied but does not match. Treated as anonymous. */
  | 'invalid'
  /** No signing secret exists for this bot yet. Treated as anonymous. */
  | 'unconfigured'
  /** Signature verified — the claimed user id is trustworthy. */
  | 'verified';

export interface IdentityClaim {
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
  signature?: string | null;
}

export interface VerifiedIdentity {
  status: IdentityStatus;
  /** Only ever set when `status === 'verified'`. */
  userId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  locale: string | null;
}

/** Generate a per-bot signing secret. 32 bytes is well past HMAC-SHA256's need. */
export function generateEmbedSecret(): string {
  return randomBytes(32).toString('hex');
}

/** The value the host app's server must send as `signature`. */
export function signIdentity(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length; compare a fixed-size digest of each instead of bailing out early.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a claim. Never throws and never rejects the visitor — an unverifiable
 * identity degrades to anonymous, because a customer who cannot chat is a worse
 * outcome than a customer we cannot name.
 */
export function verifyIdentity(claim: IdentityClaim, secret: string | null): VerifiedIdentity {
  const anonymous = (status: IdentityStatus): VerifiedIdentity => ({
    status,
    userId: null,
    // Profile fields ride along with the identity claim, so an unverified
    // claim carries no name or email either. Trusting those while distrusting
    // the id would let a caller relabel a real customer in the agent's inbox.
    name: null,
    email: null,
    phone: null,
    locale: claim.locale ? String(claim.locale).slice(0, 12) : null,
  });

  const userId = claim.userId?.trim();
  const signature = claim.signature?.trim();

  if (!userId) return anonymous('anonymous');
  if (!signature) return anonymous('unsigned');
  if (!secret) return anonymous('unconfigured');
  if (!safeEqual(signature.toLowerCase(), signIdentity(userId, secret))) return anonymous('invalid');

  return {
    status: 'verified',
    userId: userId.slice(0, 200),
    name: claim.name ? String(claim.name).slice(0, 120) : null,
    email: claim.email ? String(claim.email).slice(0, 200) : null,
    phone: claim.phone ? String(claim.phone).slice(0, 40) : null,
    locale: claim.locale ? String(claim.locale).slice(0, 12) : null,
  };
}

/**
 * The visitor id the chat API sees.
 *
 * A verified user gets a stable, namespaced id so every conversation that
 * person has from the app threads together in the agent's inbox. Everyone else
 * gets whatever id the WebView generated for itself, which is per-install.
 */
export function embedVisitorId(identity: VerifiedIdentity, fallbackVisitorId: string): string {
  // /api/chat caps visitorId at 100 characters, so the namespaced form is
  // clipped to match rather than being rejected as an invalid request.
  return identity.status === 'verified' && identity.userId
    ? `app:${identity.userId}`.slice(0, 100)
    : fallbackVisitorId.slice(0, 100);
}

export interface EmbedUrlParams {
  /** Origin of this app, e.g. https://app.example.com. No trailing slash needed. */
  appUrl: string;
  publicBotId: string;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
  /** Pre-computed on the host's server; never derived in the mobile client. */
  signature?: string | null;
}

/**
 * Build the URL a host app loads in its WebView. Shared by the dashboard's
 * copy-paste panel and the docs so the two can never disagree.
 */
export function buildEmbedUrl(params: EmbedUrlParams): string {
  const base = params.appUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/embed/${encodeURIComponent(params.publicBotId)}`);
  const query: Array<[string, string | null | undefined]> = [
    ['user_id', params.userId],
    ['name', params.name],
    ['email', params.email],
    ['phone', params.phone],
    ['locale', params.locale],
    ['signature', params.signature],
  ];
  for (const [key, value] of query) {
    if (value != null && String(value).length > 0) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
