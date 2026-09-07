import crypto from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

/**
 * API keys for the public developer platform (`/api/v1`).
 *
 * A key looks like `ak_live_<32 random chars>`. We store ONLY:
 *   - `key_hash`   — SHA-256 hex of the whole plaintext key
 *   - `key_prefix` — the first 12 characters, for display and lookup
 *
 * The plaintext is returned exactly once, at creation. A database leak
 * therefore hands an attacker hashes, not usable credentials.
 *
 * Every authenticated request resolves to exactly one `company_id` — that value
 * is the ONLY tenant scope the API layer ever trusts. A request body or query
 * string may never widen it.
 */

export const API_KEY_PREFIX = 'ak_live_';
/** Characters after the prefix. 32 chars of base62 ≈ 190 bits of entropy. */
export const API_KEY_RANDOM_LENGTH = 32;
/** How much of the key is kept in `key_prefix` for display + lookup. */
export const API_KEY_PREFIX_LENGTH = 12;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Scopes a key can hold. `*` is the wildcard granted when a company asks for
 * "full access"; everything else is a single read or write capability so a key
 * pasted into a third-party tool can be narrowed to what that tool needs.
 */
export const API_SCOPES = [
  'conversations:read',
  'conversations:write',
  'contacts:read',
  'contacts:write',
  'orders:read',
  'products:read',
  'broadcasts:write',
  'analytics:read',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'conversations:read': 'Read conversations and messages',
  'conversations:write': 'Send messages / start conversations',
  'contacts:read': 'Read contacts',
  'contacts:write': 'Create contacts',
  'orders:read': 'Read orders',
  'products:read': 'Read products',
  'broadcasts:write': 'Create broadcasts',
  'analytics:read': 'Read analytics summaries',
};

export const API_SCOPE_WILDCARD = '*';

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export interface GeneratedApiKey {
  /** Plaintext — show once, never store. */
  key: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * Cryptographically random base62 string.
 *
 * Rejection sampling (not `% 62`) so every character is uniformly distributed —
 * a modulo fold would make the first 8 letters of the alphabet measurably more
 * likely and quietly shave entropy off every key we issue.
 */
function randomBase62(length: number): string {
  const max = 256 - (256 % ALPHABET.length); // 248 → bytes ≥ 248 are rejected
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const byte of bytes) {
      if (byte >= max) continue;
      out += ALPHABET.charAt(byte % ALPHABET.length);
      if (out.length === length) break;
    }
  }
  return out;
}

/** Mint a new key. The caller must show `key` once and persist only the rest. */
export function generateApiKey(): GeneratedApiKey {
  const key = API_KEY_PREFIX + randomBase62(API_KEY_RANDOM_LENGTH);
  return {
    key,
    keyPrefix: key.slice(0, API_KEY_PREFIX_LENGTH),
    keyHash: hashApiKey(key),
  };
}

/** SHA-256 hex of a plaintext key — the only representation we store. */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim(), 'utf8').digest('hex');
}

/** Shape check before we touch the database (cheap rejection of junk tokens). */
export function isApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const body = key.slice(API_KEY_PREFIX.length);
  return body.length === API_KEY_RANDOM_LENGTH && /^[A-Za-z0-9]+$/.test(body);
}

/**
 * Constant-time hash comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — that leak is harmless (both sides are fixed-length SHA-256 hex) and
 * avoids turning a malformed row into a 500.
 */
export function verifyApiKeyHash(presentedKey: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiKey(presentedKey), 'utf8');
  const stored = Buffer.from(String(storedHash ?? ''), 'utf8');
  if (presented.length !== stored.length) return false;
  return crypto.timingSafeEqual(presented, stored);
}

/** Does this key's scope list satisfy `required`? `*` satisfies everything. */
export function hasScope(scopes: readonly string[], required: ApiScope): boolean {
  return scopes.includes(API_SCOPE_WILDCARD) || scopes.includes(required);
}

/**
 * Is a stored key still usable? Revocation and expiry are the two ways a key
 * that once authenticated stops doing so, and both must be checked on EVERY
 * request — a revoked key that keeps working is the whole reason the button
 * exists. Kept pure so it can be tested without a database.
 */
export interface StoredKeyLifecycle {
  revoked_at?: string | null;
  expires_at?: string | null;
}

export function isKeyUsable(key: StoredKeyLifecycle, now = Date.now()): boolean {
  if (key.revoked_at) return false;
  if (key.expires_at && new Date(key.expires_at).getTime() <= now) return false;
  return true;
}

/** Pull the bearer token out of the Authorization header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export interface ApiKeyPrincipal {
  companyId: string;
  apiKeyId: string;
  scopes: string[];
}

interface ApiKeyRow {
  id: string;
  company_id: string;
  scopes: string[] | null;
  key_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * `last_used_at` is useful but must not cost a write per request. One update a
 * minute per key is plenty to answer "is this key still in use?", and the
 * in-process memo means a burst of traffic on one instance writes once.
 */
const TOUCH_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

async function touchLastUsed(row: ApiKeyRow): Promise<void> {
  const now = Date.now();
  const memo = lastTouched.get(row.id) ?? 0;
  const stored = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (now - memo < TOUCH_INTERVAL_MS || now - stored < TOUCH_INTERVAL_MS) return;
  lastTouched.set(row.id, now);
  try {
    await createSupabaseServiceClient()
      .from('api_keys')
      .update({ last_used_at: new Date(now).toISOString() })
      .eq('id', row.id);
  } catch {
    // Never fail a request because a usage timestamp could not be written.
  }
}

/**
 * Authenticate an inbound `/api/v1` request.
 *
 * Returns the tenant scope for the key, or `null` for anything that is not a
 * live, unrevoked, unexpired key. Callers must treat `null` as 401 and must
 * never fall back to a company id taken from the request.
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyPrincipal | null> {
  const token = bearerToken(request);
  if (!token || !isApiKeyFormat(token)) return null;

  const prefix = token.slice(0, API_KEY_PREFIX_LENGTH);
  let rows: ApiKeyRow[] = [];
  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from('api_keys')
      .select('id,company_id,scopes,key_hash,expires_at,revoked_at,last_used_at')
      // The prefix is only 3 random characters, so it is a narrowing filter,
      // not an identity — the constant-time hash compare below decides.
      .eq('key_prefix', prefix)
      .limit(50);
    if (error) throw error;
    rows = (data ?? []) as ApiKeyRow[];
  } catch (err) {
    logger.error('API key lookup failed', {
      module: 'api-keys',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const match = rows.find((row) => verifyApiKeyHash(token, row.key_hash));
  if (!match) return null;
  if (!isKeyUsable(match)) return null;

  await touchLastUsed(match);

  return {
    companyId: match.company_id,
    apiKeyId: match.id,
    scopes: match.scopes ?? [],
  };
}
