// Web push + mobile embed verification — pure logic, no database, no network.
//
// Two features are covered here because both are cryptographic, and both fail
// SILENTLY when they are wrong: a malformed VAPID JWT produces a push the
// service simply drops, and a mis-verified HMAC produces a customer
// impersonating another customer with no error anywhere. Neither shows up in a
// smoke test, so the maths is checked directly.
//
// The real TypeScript is transpiled and exercised (scripts/lib/ts-load.mjs);
// only Supabase, the logger and the error sink are stubbed.
import {
  createECDH,
  createDecipheriv,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify as cryptoVerify,
} from 'node:crypto';
import { loadTs, makeChecker } from './lib/ts-load.mjs';

const { check: rawCheck, state } = makeChecker();

// Several assertions below are multi-statement (decode a buffer, compare it) or
// assert that something THROWS. Accepting a thunk keeps those readable, and a
// thunk that throws unexpectedly is reported as a failure rather than killing
// the run halfway through.
const check = (label, condition, detail) => {
  let value = condition;
  if (typeof condition === 'function') {
    try {
      value = condition();
    } catch (err) {
      rawCheck(label, false, `threw: ${err.message}`);
      return;
    }
  }
  rawCheck(label, Boolean(value), detail);
};

const dbStub = `
export function createSupabaseServiceClient() {
  throw new Error('the database must not be touched by a pure-logic test');
}
`;
const loggerStub = `export const logger = { info() {}, warn() {}, error() {}, debug() {} };`;
const errorsStub = `
export function errorMessage(e) { return e instanceof Error ? e.message : String(e); }
export function errorStack() { return null; }
export async function logAppError() {}
`;

const modules = await loadTs(
  [
    'src/lib/push/vapid.ts',
    'src/lib/push/encrypt.ts',
    'src/lib/push/index.ts',
    'src/lib/push/fanout.ts',
    'src/lib/embed/identity.ts',
  ],
  {
    '@/lib/db/server': dbStub,
    '@/lib/logger': loggerStub,
    '@/lib/application-errors': errorsStub,
  },
);

const vapid = modules['src/lib/push/vapid.ts'];
const encrypt = modules['src/lib/push/encrypt.ts'];
const push = modules['src/lib/push/index.ts'];
const fanout = modules['src/lib/push/fanout.ts'];
const identity = modules['src/lib/embed/identity.ts'];

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (str) => Buffer.from(str, 'base64url');

// ---------------------------------------------------------------------------
// 1. VAPID key handling
// ---------------------------------------------------------------------------
const keys = vapid.generateVapidKeys();

check('generated public key is a 65-byte uncompressed P-256 point', () => {
  const point = fromB64url(keys.publicKey);
  return point.length === 65 && point[0] === 0x04;
});
check('generated private key is a 32-byte scalar', fromB64url(keys.privateKey).length === 32);
check('keys round-trip into a usable signing key', () => {
  const key = vapid.importVapidPrivateKey(keys.publicKey, keys.privateKey);
  return key.asymmetricKeyType === 'ec';
});
check('a public key of the wrong length is rejected, not silently used', () => {
  try {
    vapid.importVapidPrivateKey(b64url(Buffer.alloc(10)), keys.privateKey);
    return false;
  } catch {
    return true;
  }
});
check('a private key of the wrong length is rejected', () => {
  try {
    vapid.importVapidPrivateKey(keys.publicKey, b64url(Buffer.alloc(8)));
    return false;
  } catch {
    return true;
  }
});

check('getVapidKeys returns null when nothing is configured', vapid.getVapidKeys({}) === null);
check('getVapidKeys requires BOTH halves', vapid.getVapidKeys({ VAPID_PUBLIC_KEY: keys.publicKey }) === null);
check(
  'a missing subject falls back to a contact URI rather than an empty claim',
  vapid.getVapidKeys({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }).subject.startsWith(
    'mailto:',
  ),
);

// ---------------------------------------------------------------------------
// 2. VAPID JWT construction (RFC 8292)
// ---------------------------------------------------------------------------
const vapidKeys = { ...keys, subject: 'mailto:ops@example.com' };
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123?token=xyz';

const jwt = vapid.buildVapidJwt({ endpoint, keys: vapidKeys, nowMs: NOW });
const [headerSegment, claimsSegment, signatureSegment] = jwt.token.split('.');
const header = JSON.parse(fromB64url(headerSegment).toString('utf8'));
const claims = JSON.parse(fromB64url(claimsSegment).toString('utf8'));

check('the JWT has exactly three segments', jwt.token.split('.').length === 3);
check('header declares ES256', header.alg === 'ES256' && header.typ === 'JWT');
check('aud is the push service ORIGIN, not the whole endpoint', claims.aud === 'https://fcm.googleapis.com');
check('sub carries the configured contact URI', claims.sub === 'mailto:ops@example.com');
check('exp is 12 hours out by default', claims.exp === Math.floor(NOW / 1000) + 12 * 60 * 60);
check(
  'exp is capped below the 24h ceiling even when more is asked for',
  vapid.buildVapidJwt({ endpoint, keys: vapidKeys, nowMs: NOW, expirySeconds: 99999 }).claims.exp -
    Math.floor(NOW / 1000) <
    24 * 60 * 60,
);
check(
  'the JWT is base64url, with no padding or +/ characters',
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt.token),
);
check('the signature is a raw 64-byte r‖s pair, not ASN.1 DER', fromB64url(signatureSegment).length === 64);

// The signature must actually verify against the public half — a JWT that is
// merely well-shaped is exactly the bug this catches.
const publicKeyObject = createPublicKey({
  key: {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(fromB64url(keys.publicKey).subarray(1, 33)),
    y: b64url(fromB64url(keys.publicKey).subarray(33, 65)),
  },
  format: 'jwk',
});
check(
  'the signature verifies against the VAPID public key',
  cryptoVerify(
    'sha256',
    Buffer.from(`${headerSegment}.${claimsSegment}`, 'utf8'),
    { key: publicKeyObject, dsaEncoding: 'ieee-p1363' },
    fromB64url(signatureSegment),
  ),
);
check(
  'a tampered claim breaks the signature',
  !cryptoVerify(
    'sha256',
    Buffer.from(`${headerSegment}.${b64url(Buffer.from(JSON.stringify({ ...claims, sub: 'mailto:attacker@evil' })))}`, 'utf8'),
    { key: publicKeyObject, dsaEncoding: 'ieee-p1363' },
    fromB64url(signatureSegment),
  ),
);

const authHeader = vapid.vapidAuthorizationHeader({ endpoint, keys: vapidKeys, nowMs: NOW });
check('Authorization header uses the vapid scheme with t= and k=', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(authHeader));
check('the k= parameter is the public key verbatim', authHeader.endsWith(`k=${keys.publicKey}`));

// ---------------------------------------------------------------------------
// 3. Payload encryption (RFC 8291 / RFC 8188) — decrypted here as the browser
//    would, which is the only way to know the sequence is right.
// ---------------------------------------------------------------------------
const ua = createECDH('prime256v1');
const uaPublic = ua.generateKeys();
const uaAuth = randomBytes(16);
const subscription = { p256dh: b64url(uaPublic), auth: b64url(uaAuth) };

const plaintext = JSON.stringify({ title: 'A customer needs a person', url: '/company/inbox/42' });
const body = encrypt.encryptPushPayload(plaintext, subscription);

const salt = body.subarray(0, 16);
const recordSize = body.readUInt32BE(16);
const keyIdLength = body[20];
const asPublic = body.subarray(21, 21 + keyIdLength);
const ciphertext = body.subarray(21 + keyIdLength);

check('header carries a 16-byte salt', salt.length === 16);
check('record size is the declared 4096', recordSize === 4096);
check('key id is the 65-byte server public key', keyIdLength === 65 && asPublic[0] === 0x04);
check('ciphertext is plaintext + delimiter + 16-byte GCM tag', ciphertext.length === Buffer.byteLength(plaintext) + 1 + 16);
check('two encryptions of the same payload differ (fresh salt and key each time)', () => {
  const again = encrypt.encryptPushPayload(plaintext, subscription);
  return !again.equals(body);
});

const decrypted = (() => {
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, uaAuth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
})();

check('a browser holding the subscription keys can decrypt it', decrypted.subarray(0, -1).toString('utf8') === plaintext);
check('the last record is marked with the 0x02 padding delimiter', decrypted[decrypted.length - 1] === 0x02);

check('a p256dh that is not an uncompressed point is refused', () => {
  try {
    encrypt.encryptPushPayload('x', { p256dh: b64url(Buffer.alloc(65)), auth: subscription.auth });
    return false;
  } catch {
    return true;
  }
});
check('an auth secret of the wrong length is refused', () => {
  try {
    encrypt.encryptPushPayload('x', { p256dh: subscription.p256dh, auth: b64url(Buffer.alloc(8)) });
    return false;
  } catch {
    return true;
  }
});
check('an oversized payload is refused rather than silently truncated', () => {
  try {
    encrypt.encryptPushPayload('x'.repeat(5000), subscription);
    return false;
  } catch {
    return true;
  }
});

// ---------------------------------------------------------------------------
// 4. Delivery result handling and pruning
// ---------------------------------------------------------------------------
check('410 Gone prunes the subscription', push.shouldPruneSubscription(410));
check('404 Not Found prunes the subscription', push.shouldPruneSubscription(404));
check('500 does NOT prune — a push-service outage must not unsubscribe anyone', !push.shouldPruneSubscription(500));
check('429 does NOT prune', !push.shouldPruneSubscription(429));
check('a network error (null status) does NOT prune', !push.shouldPruneSubscription(null));
check('201 is a success', push.isSuccessStatus(201));
check('204 is a success', push.isSuccessStatus(204));
check('400 is not a success', !push.isSuccessStatus(400));

const serialized = JSON.parse(
  push.serializePayload({
    title: 'T'.repeat(500),
    body: 'B'.repeat(900),
    url: '/company/inbox/1',
    type: 'human_takeover',
  }),
);
check('an over-long title is clipped to fit the 4096-byte record', serialized.title.length === 120);
check('an over-long body is clipped too', serialized.body.length === 400);
check('the target url survives serialization untouched', serialized.url === '/company/inbox/1');

// sendWebPush against a fake push service: the real code path, real crypto,
// real headers, with only the network replaced.
const originalFetch = globalThis.fetch;
let lastRequest = null;
globalThis.fetch = async (url, init) => {
  lastRequest = { url, init };
  const status = url.includes('/gone') ? 410 : url.includes('/broken') ? 500 : 201;
  return { status, ok: status < 300 };
};

const okResult = await push.sendWebPush(
  { endpoint: 'https://push.example.com/ok', ...subscription },
  { title: 'Hello', type: 'new_lead' },
  { keys: vapidKeys },
);
check('a 201 from the push service is a delivery', okResult.ok && !okResult.pruned);
check('the request carries the aes128gcm content encoding', lastRequest.init.headers['Content-Encoding'] === 'aes128gcm');
check('the request carries a vapid Authorization header', lastRequest.init.headers.Authorization.startsWith('vapid t='));
check('a TTL is always set', Number(lastRequest.init.headers.TTL) > 0);
check('the body is the encrypted record, not JSON', lastRequest.init.body instanceof Uint8Array);

const goneResult = await push.sendWebPush(
  { endpoint: 'https://push.example.com/gone', ...subscription },
  { title: 'Hello' },
  { keys: vapidKeys },
);
check('a 410 marks the subscription for pruning', goneResult.pruned && !goneResult.ok);

const brokenResult = await push.sendWebPush(
  { endpoint: 'https://push.example.com/broken', ...subscription },
  { title: 'Hello' },
  { keys: vapidKeys },
);
check('a 500 fails without pruning', !brokenResult.ok && !brokenResult.pruned);

globalThis.fetch = async () => {
  throw new Error('ECONNRESET');
};
const networkResult = await push.sendWebPush(
  { endpoint: 'https://push.example.com/ok', ...subscription },
  { title: 'Hello' },
  { keys: vapidKeys },
);
check('a thrown network error is captured, not propagated', !networkResult.ok && networkResult.statusCode === null);
check('a network error never prunes', !networkResult.pruned);
globalThis.fetch = originalFetch;

const unconfigured = await push.sendWebPush({ endpoint: 'https://push.example.com/ok', ...subscription }, { title: 'x' }, {
  keys: null,
});
check('with no VAPID keys the send reports why instead of throwing', unconfigured.error === 'vapid_not_configured');

// ---------------------------------------------------------------------------
// 5. Which events become a push, and where a tap lands
// ---------------------------------------------------------------------------
check('a handoff request pushes by default', fanout.pushAllowedForEvent(null, 'human_takeover'));
check('a new lead pushes by default', fanout.pushAllowedForEvent(null, 'new_lead'));
check('an SLA breach pushes by default', fanout.pushAllowedForEvent(null, 'sla_breach'));
check('a failed sync does NOT push by default', !fanout.pushAllowedForEvent(null, 'failed_sync'));
check(
  'the company master switch turns every push off',
  !fanout.pushAllowedForEvent({ notificationsEnabled: false, eventRules: {} }, 'human_takeover'),
);
check(
  'an explicit per-event rule beats the priority default (off)',
  !fanout.pushAllowedForEvent(
    { notificationsEnabled: true, eventRules: { human_takeover: { push: false } } },
    'human_takeover',
  ),
);
check(
  'an explicit per-event rule beats the priority default (on)',
  fanout.pushAllowedForEvent({ notificationsEnabled: true, eventRules: { failed_sync: { push: true } } }, 'failed_sync'),
);
check(
  'a rule for another channel does not decide push',
  !fanout.pushAllowedForEvent({ notificationsEnabled: true, eventRules: { failed_sync: { email: true } } }, 'failed_sync'),
);

check(
  'a conversation id always wins as the tap target',
  fanout.pushTargetUrl('new_lead', { conversationId: 'c-1' }) === '/company/inbox/c-1',
);
check('a lead with no conversation lands on the leads list', fanout.pushTargetUrl('new_lead', {}) === '/company/leads');
check('an unknown event still has somewhere to land', fanout.pushTargetUrl('who_knows') === '/company/notifications');

const payload = fanout.buildPushPayload({
  type: 'human_takeover',
  title: 'A customer asked for a person',
  body: 'Order 1183',
  data: { conversationId: 'c-9' },
});
check('the payload carries the conversation deep link', payload.url === '/company/inbox/c-9');
check('alerts for one conversation collapse onto each other', payload.tag === 'conversation:c-9');
check('the event type rides along for client-side filtering', payload.type === 'human_takeover');
check(
  'without a conversation, alerts collapse per event type instead',
  fanout.buildPushPayload({ type: 'new_order', title: 'New order' }).tag === 'event:new_order',
);

// ---------------------------------------------------------------------------
// 6. Mobile embed identity — the impersonation boundary
// ---------------------------------------------------------------------------
const secret = identity.generateEmbedSecret();
const otherSecret = identity.generateEmbedSecret();
const userId = 'cus_10025';
const signature = identity.signIdentity(userId, secret);

check('a generated secret is 32 bytes of hex', /^[0-9a-f]{64}$/.test(secret));
check('two generated secrets differ', secret !== otherSecret);
check('signing is deterministic', identity.signIdentity(userId, secret) === signature);
check('a different user id produces a different signature', identity.signIdentity('cus_10026', secret) !== signature);

const verified = identity.verifyIdentity(
  { userId, signature, name: 'Sam Okafor', email: 'sam@example.com', locale: 'en' },
  secret,
);
check('a correctly signed claim verifies', verified.status === 'verified');
check('the verified user id is carried through', verified.userId === userId);
check('the profile fields come with a verified identity', verified.name === 'Sam Okafor' && verified.email === 'sam@example.com');

const tampered = identity.verifyIdentity({ userId: 'cus_99999', signature }, secret);
check('a tampered user id does NOT verify', tampered.status === 'invalid');
check('a tampered claim yields no user id at all', tampered.userId === null);

const wrongKey = identity.verifyIdentity({ userId, signature: identity.signIdentity(userId, otherSecret) }, secret);
check('a signature made with the wrong secret does not verify', wrongKey.status === 'invalid');

const unsigned = identity.verifyIdentity({ userId, name: 'Sam Okafor' }, secret);
check('an unsigned claim falls back to anonymous', unsigned.status === 'unsigned');
check('an unsigned claim carries no user id', unsigned.userId === null);
check('an unsigned claim carries no name either — no half-trusted identity', unsigned.name === null);

check('no claim at all is plain anonymous', identity.verifyIdentity({}, secret).status === 'anonymous');
check(
  'a signed claim with no secret configured is anonymous, not an error',
  identity.verifyIdentity({ userId, signature }, null).status === 'unconfigured',
);
check(
  'an uppercase hex signature still verifies',
  identity.verifyIdentity({ userId, signature: signature.toUpperCase() }, secret).status === 'verified',
);
check(
  'a signature of the wrong length is rejected without throwing',
  identity.verifyIdentity({ userId, signature: 'abc' }, secret).status === 'invalid',
);
check('the locale survives even for an anonymous visitor', identity.verifyIdentity({ locale: 'ar' }, secret).locale === 'ar');

check(
  'a verified user gets a stable namespaced visitor id',
  identity.embedVisitorId(verified, 'web-throwaway') === `app:${userId}`,
);
check(
  'an anonymous visitor keeps the id the device generated',
  identity.embedVisitorId(unsigned, 'web-throwaway') === 'web-throwaway',
);
check(
  'the visitor id stays inside the 100-character limit /api/chat enforces',
  identity.embedVisitorId(
    identity.verifyIdentity({ userId: 'u'.repeat(190), signature: identity.signIdentity('u'.repeat(190), secret) }, secret),
    'web',
  ).length <= 100,
);

// ---------------------------------------------------------------------------
// 7. Embed URL builder
// ---------------------------------------------------------------------------
const bare = identity.buildEmbedUrl({ appUrl: 'https://app.example.com', publicBotId: 'bot123' });
check('a bare embed url is just the path', bare === 'https://app.example.com/embed/bot123');
check(
  'a trailing slash on the app url does not double up',
  identity.buildEmbedUrl({ appUrl: 'https://app.example.com/', publicBotId: 'bot123' }) === bare,
);

const full = new URL(
  identity.buildEmbedUrl({
    appUrl: 'https://app.example.com',
    publicBotId: 'bot123',
    userId,
    name: 'Sam Okafor',
    email: 'sam@example.com',
    locale: 'en',
    signature,
  }),
);
check('the user id is passed through', full.searchParams.get('user_id') === userId);
check('the signature is passed through', full.searchParams.get('signature') === signature);
check('a space in the name is encoded, not dropped', full.searchParams.get('name') === 'Sam Okafor');
check('empty values are omitted rather than sent blank', () => {
  const url = new URL(
    identity.buildEmbedUrl({ appUrl: 'https://app.example.com', publicBotId: 'bot123', userId, name: '', phone: null }),
  );
  return !url.searchParams.has('name') && !url.searchParams.has('phone');
});
check('a bot id needing encoding is encoded', identity.buildEmbedUrl({ appUrl: 'https://a.example', publicBotId: 'a b' }).endsWith('/embed/a%20b'));

console.log(`\n${state.failed === 0 ? '✅' : '❌'} Web push + mobile embed: ${state.passed} passed, ${state.failed} failed`);
process.exit(state.failed === 0 ? 0 : 1);
