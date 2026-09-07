import {
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

/**
 * VAPID (RFC 8292) — the half of Web Push that proves to Google/Mozilla/Apple's
 * push service that *we* are the application server allowed to push to this
 * subscription.
 *
 * Implemented on `node:crypto` alone, deliberately: a VAPID credential is an
 * ES256 JWT and nothing more, so pulling in a signing library to produce two
 * base64url segments and a 64-byte signature would be a dependency for
 * ~40 lines of code. The one non-obvious part is the signature encoding —
 * `createSign().sign()` emits ASN.1 DER by default and JOSE requires the raw
 * r‖s pair, which `dsaEncoding: 'ieee-p1363'` gives us directly.
 *
 * Key format matches what every VAPID generator (web-push, the browser
 * `applicationServerKey`) uses:
 *   public  — base64url of the 65-byte uncompressed P-256 point (0x04 ‖ x ‖ y)
 *   private — base64url of the 32-byte private scalar
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const P256_POINT_BYTES = 65;
const P256_SCALAR_BYTES = 32;

export function base64UrlEncode(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString('base64url');
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Read the VAPID credentials from the environment. Returns null — never throws
 * — when push is simply not configured, so every caller can degrade to "push is
 * off" instead of taking the request down with it.
 */
export function getVapidKeys(env: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.VAPID_SUBJECT ?? '').trim();
  if (!publicKey || !privateKey) return null;
  // RFC 8292 §2.1: `sub` must be a contact URI. A missing one is a
  // misconfiguration we can safely paper over rather than refuse to push.
  return { publicKey, privateKey, subject: subject || 'mailto:support@localhost' };
}

export function isPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getVapidKeys(env) !== null;
}

/** Generate a fresh VAPID pair in the exact format the env vars expect. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const priv = privateKey.export({ format: 'jwk' }) as { d: string };
  const point = Buffer.concat([
    Buffer.from([0x04]),
    base64UrlDecode(pub.x),
    base64UrlDecode(pub.y),
  ]);
  return { publicKey: base64UrlEncode(point), privateKey: priv.d };
}

/**
 * Rebuild a signing key from the two raw values. Node cannot import a bare
 * 32-byte scalar, but it can import a JWK, and the x/y coordinates the JWK
 * needs are simply the two halves of the public point we already hold.
 */
export function importVapidPrivateKey(publicKey: string, privateKey: string): KeyObject {
  const point = base64UrlDecode(publicKey);
  if (point.length !== P256_POINT_BYTES || point[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point (65 bytes).');
  }
  const d = base64UrlDecode(privateKey);
  if (d.length !== P256_SCALAR_BYTES) {
    throw new Error('VAPID_PRIVATE_KEY must be a base64url 32-byte P-256 scalar.');
  }
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(point.subarray(1, 33)),
      y: base64UrlEncode(point.subarray(33, 65)),
      d: base64UrlEncode(d),
    },
    format: 'jwk',
  });
}

/** The `aud` claim is the push service's ORIGIN, not the full endpoint URL. */
export function audienceFor(endpoint: string): string {
  return new URL(endpoint).origin;
}

export interface VapidJwtParts {
  header: { typ: 'JWT'; alg: 'ES256' };
  claims: { aud: string; exp: number; sub: string };
  token: string;
}

/**
 * Build the signed VAPID JWT for one endpoint. `expirySeconds` is capped at the
 * 24h ceiling RFC 8292 imposes; 12h is the customary value and leaves room for
 * clock skew at both ends.
 */
export function buildVapidJwt(params: {
  endpoint: string;
  keys: VapidKeys;
  nowMs?: number;
  expirySeconds?: number;
}): VapidJwtParts {
  const now = params.nowMs ?? Date.now();
  const requested = params.expirySeconds ?? 12 * 60 * 60;
  const expirySeconds = Math.min(requested, 24 * 60 * 60 - 60);

  const header = { typ: 'JWT', alg: 'ES256' } as const;
  const claims = {
    aud: audienceFor(params.endpoint),
    exp: Math.floor(now / 1000) + expirySeconds,
    sub: params.keys.subject,
  };

  const signingInput = `${base64UrlEncode(Buffer.from(JSON.stringify(header)))}.${base64UrlEncode(
    Buffer.from(JSON.stringify(claims)),
  )}`;

  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({
      key: importVapidPrivateKey(params.keys.publicKey, params.keys.privateKey),
      dsaEncoding: 'ieee-p1363',
    });

  return { header, claims, token: `${signingInput}.${base64UrlEncode(signature)}` };
}

/** The `Authorization` header value for a push request (RFC 8292 §3.1). */
export function vapidAuthorizationHeader(params: {
  endpoint: string;
  keys: VapidKeys;
  nowMs?: number;
}): string {
  const { token } = buildVapidJwt(params);
  return `vapid t=${token}, k=${params.keys.publicKey}`;
}
