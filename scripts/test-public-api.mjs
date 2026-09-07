// Public developer platform checks (API keys + /api/v1 envelope shaping).
//
// Runs offline: the pure halves of `src/lib/api-keys.ts` and
// `src/lib/api/handler.ts` are loaded straight from source into a vm sandbox, so
// these assertions test the SHIPPING code rather than a copy of it. Nothing is
// stubbed except Next's `NextResponse`, which only has to record what the
// handler passed it.
//
// When DATABASE_URL is present in .env.local (same pattern as scripts/migrate.mjs)
// the script also round-trips a real `api_keys` row: insert with a hash, look it
// up by prefix, verify it, revoke it, and confirm it stops authenticating.
//
// Usage: node scripts/test-public-api.mjs
import { config } from 'dotenv';
config({ path: '.env.local' });

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label, condition, extra = '') {
  console.log(`${condition ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!condition) failures++;
}

// ---------------------------------------------------------------------------
// Load the pure parts of the TypeScript sources.
// ---------------------------------------------------------------------------

/**
 * Strip the type-only syntax this codebase uses so the pure functions can run
 * under plain Node. Deliberately narrow: it handles imports, interfaces, type
 * aliases, `as const`, annotated consts, and single-line signatures — the only
 * constructs in the regions we load. Anything fancier belongs behind the cut.
 */
function stripTypes(source) {
  const stripped = source
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export interface [\s\S]*?^}\n/gm, '')
    .replace(/^interface [\s\S]*?^}\n/gm, '')
    .replace(/^export type [\s\S]*?;\n/gm, '')
    .replace(/ as const/g, '')
    // `(API_SCOPES as readonly string[]).includes(x)` → `(API_SCOPES).includes(x)`
    .replace(/\s+as\s+(?:readonly\s+)?[A-Za-z_$][\w$.<>[\]| ]*(?=[),;])/g, '');

  return stripped
    .split('\n')
    .map((raw) => {
      let line = raw.replace(/^export /, '');
      // Class field declarations (`readonly code: ApiErrorCode;`) are TS-only.
      if (/^\s*(readonly|private|public|protected)\s+\w+\??:\s*[^=(]+;\s*$/.test(line)) return '';
      // `const NAME: SomeType = …` → `const NAME = …`
      line = line.replace(/^(\s*)const (\w+):\s*[^=]+=/, '$1const $2 =');
      // Function / constructor signatures: generics, optional markers, types.
      if (/^\s*(async\s+)?(function|constructor)\b/.test(line)) {
        line = line
          .replace(/<[^<>()]*>\s*\(/g, '(')
          .replace(/\?\s*:/g, ':')
          .replace(/:\s*[^,()]+(?=[,)])/g, '')
          .replace(/\)\s*:\s*[^{;]+(?=[{;])/g, ')');
      }
      return line;
    })
    .join('\n');
}

/**
 * Everything in `file` before `marker` — the part with no server imports.
 *
 * `const` bindings stay in the script's lexical scope rather than landing on the
 * sandbox object, so the wanted names are collected by a trailing assignment.
 */
function loadPureRegion(file, marker, context, names) {
  // Normalise line endings: this repo is checked out with CRLF on Windows, and
  // every pattern in `stripTypes` anchors on "\n".
  const source = readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const cut = source.indexOf(marker);
  if (cut === -1) throw new Error(`Marker "${marker}" not found in ${file}`);
  vm.createContext(context);
  const code = `${stripTypes(source.slice(0, cut))}\n;__exports = { ${names.join(', ')} };`;
  vm.runInContext(code, context, { filename: file });
  return context.__exports;
}

const keysApi = loadPureRegion(
  'src/lib/api-keys.ts',
  'export interface ApiKeyPrincipal',
  { crypto, Buffer, Date, URLSearchParams, console },
  [
    'API_KEY_PREFIX',
    'API_KEY_RANDOM_LENGTH',
    'API_KEY_PREFIX_LENGTH',
    'API_SCOPES',
    'API_SCOPE_LABELS',
    'generateApiKey',
    'hashApiKey',
    'isApiKeyFormat',
    'verifyApiKeyHash',
    'hasScope',
    'isKeyUsable',
    'bearerToken',
  ],
);

/** Minimal stand-in for `NextResponse.json` — records body + status. */
const responses = [];
const NextResponse = {
  json(body, init) {
    const entry = { body, status: (init && init.status) || 200 };
    responses.push(entry);
    return entry;
  },
};
const handlerApi = loadPureRegion(
  'src/lib/api/handler.ts',
  'export interface ApiContext',
  { NextResponse, Date, Number, URLSearchParams, console },
  ['ApiError', 'apiData', 'apiErrorResponse', 'parsePagination', 'paginationMeta', 'parseIsoDate'],
);

const {
  API_KEY_PREFIX,
  API_KEY_RANDOM_LENGTH,
  API_KEY_PREFIX_LENGTH,
  API_SCOPES,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  verifyApiKeyHash,
  hasScope,
  isKeyUsable,
  bearerToken,
} = keysApi;

const { ApiError, apiData, apiErrorResponse, parsePagination, paginationMeta, parseIsoDate } =
  handlerApi;

// ---------------------------------------------------------------------------
// 1. Key generation format
// ---------------------------------------------------------------------------
console.log('\n— Key generation —');
const generated = generateApiKey();
check('Key uses the ak_live_ prefix', generated.key.startsWith('ak_live_'), generated.key.slice(0, 12));
check(
  'Key body is 32 base62 characters',
  /^ak_live_[A-Za-z0-9]{32}$/.test(generated.key),
  `length ${generated.key.length}`,
);
check(
  'key_prefix is the first 12 characters of the key',
  generated.keyPrefix === generated.key.slice(0, API_KEY_PREFIX_LENGTH) &&
    generated.keyPrefix.length === 12,
  generated.keyPrefix,
);
check(
  'Constants agree with the emitted key',
  API_KEY_PREFIX === 'ak_live_' &&
    API_KEY_RANDOM_LENGTH === 32 &&
    generated.key.length === API_KEY_PREFIX.length + API_KEY_RANDOM_LENGTH,
);

const many = new Set();
for (let i = 0; i < 500; i++) many.add(generateApiKey().key);
check('500 generated keys are all distinct', many.size === 500, `${many.size} unique`);

const alphabetSeen = new Set();
for (const key of many) for (const ch of key.slice(9)) alphabetSeen.add(ch);
check(
  'Random body draws from the whole base62 alphabet',
  alphabetSeen.size >= 60,
  `${alphabetSeen.size} distinct characters`,
);

// ---------------------------------------------------------------------------
// 2. Hashing + constant-time verification
// ---------------------------------------------------------------------------
console.log('\n— Hashing & verification —');
const independentHash = crypto.createHash('sha256').update(generated.key, 'utf8').digest('hex');
check('hashApiKey is SHA-256 hex of the plaintext', generated.keyHash === independentHash);
check('Hash is 64 hex characters', /^[0-9a-f]{64}$/.test(generated.keyHash));
check(
  'The plaintext key never appears inside the stored hash',
  !generated.keyHash.includes(generated.key.slice(9)),
);
check('Hashing is stable across calls', hashApiKey(generated.key) === generated.keyHash);
check('Surrounding whitespace is tolerated', hashApiKey(`  ${generated.key}  `) === generated.keyHash);

check('verifyApiKeyHash accepts the matching key', verifyApiKeyHash(generated.key, generated.keyHash));
check(
  'verifyApiKeyHash rejects a different key',
  !verifyApiKeyHash(generateApiKey().key, generated.keyHash),
);
let threw = false;
try {
  check('verifyApiKeyHash rejects a truncated hash', !verifyApiKeyHash(generated.key, 'deadbeef'));
  check('verifyApiKeyHash rejects an empty hash', !verifyApiKeyHash(generated.key, ''));
  check('verifyApiKeyHash rejects a null hash', !verifyApiKeyHash(generated.key, null));
} catch (err) {
  threw = true;
  console.log('   threw:', err.message);
}
check('Length mismatches never throw (constant-time compare is guarded)', !threw);

console.log('\n— Key shape rejection —');
for (const junk of [
  '',
  'ak_live_',
  'rvk_test_' + 'a'.repeat(32),
  'ak_live_' + 'a'.repeat(31),
  'ak_live_' + 'a'.repeat(33),
  'ak_live_' + 'a'.repeat(31) + '!',
  'Bearer ak_live_' + 'a'.repeat(32),
]) {
  check(`isApiKeyFormat rejects ${JSON.stringify(junk.slice(0, 24))}`, !isApiKeyFormat(junk));
}
check('isApiKeyFormat accepts a freshly minted key', isApiKeyFormat(generated.key));

// ---------------------------------------------------------------------------
// 3. Expiry / revocation
// ---------------------------------------------------------------------------
console.log('\n— Expiry & revocation —');
const hour = 3_600_000;
const now = Date.now();
check('A live key is usable', isKeyUsable({ revoked_at: null, expires_at: null }, now));
check(
  'A key expiring in the future is usable',
  isKeyUsable({ revoked_at: null, expires_at: new Date(now + hour).toISOString() }, now),
);
check(
  'An expired key is rejected',
  !isKeyUsable({ revoked_at: null, expires_at: new Date(now - hour).toISOString() }, now),
);
check(
  'A key expiring exactly now is rejected',
  !isKeyUsable({ revoked_at: null, expires_at: new Date(now).toISOString() }, now),
);
check(
  'A revoked key is rejected even with no expiry',
  !isKeyUsable({ revoked_at: new Date(now - hour).toISOString(), expires_at: null }, now),
);
check(
  'A revoked key is rejected even when unexpired',
  !isKeyUsable(
    { revoked_at: new Date(now - hour).toISOString(), expires_at: new Date(now + hour).toISOString() },
    now,
  ),
);

// ---------------------------------------------------------------------------
// 4. Scope checking
// ---------------------------------------------------------------------------
console.log('\n— Scopes —');
check('An exact scope match is allowed', hasScope(['contacts:read'], 'contacts:read'));
check('A missing scope is refused', !hasScope(['contacts:read'], 'contacts:write'));
check('An empty scope list refuses everything', !hasScope([], 'conversations:read'));
check('The wildcard satisfies every scope', API_SCOPES.every((scope) => hasScope(['*'], scope)));
check(
  'A read scope never implies its write counterpart',
  !hasScope(['conversations:read'], 'conversations:write') &&
    !hasScope(['orders:read'], 'broadcasts:write'),
);
check(
  'Every documented scope is in API_SCOPES',
  [
    'conversations:read',
    'conversations:write',
    'contacts:read',
    'contacts:write',
    'orders:read',
    'products:read',
    'broadcasts:write',
    'analytics:read',
  ].every((scope) => API_SCOPES.includes(scope)),
  API_SCOPES.join(', '),
);

console.log('\n— Bearer parsing —');
const header = (value) => ({ headers: { get: () => value } });
check('Bearer token is extracted', bearerToken(header(`Bearer ${generated.key}`)) === generated.key);
check('The scheme is case-insensitive', bearerToken(header(`bearer ${generated.key}`)) === generated.key);
check('Surrounding whitespace is trimmed', bearerToken(header(`  Bearer  ${generated.key}  `)) === generated.key);
check('A missing header yields null', bearerToken(header(null)) === null);
check('A non-bearer scheme yields null', bearerToken(header(`Basic ${generated.key}`)) === null);
check('A bare token yields null', bearerToken(header(generated.key)) === null);

// ---------------------------------------------------------------------------
// 5. Pagination meta shaping
// ---------------------------------------------------------------------------
console.log('\n— Pagination —');
const defaults = parsePagination(new URLSearchParams(''));
check(
  'Defaults are page 1, 25 per page, range 0–24',
  defaults.page === 1 && defaults.perPage === 25 && defaults.from === 0 && defaults.to === 24,
  JSON.stringify(defaults),
);
const third = parsePagination(new URLSearchParams('page=3&per_page=10'));
check(
  'Page 3 of 10 maps to range 20–29',
  third.page === 3 && third.perPage === 10 && third.from === 20 && third.to === 29,
  JSON.stringify(third),
);
const clamped = parsePagination(new URLSearchParams('per_page=5000'));
check('per_page is clamped to 100', clamped.perPage === 100, String(clamped.perPage));
for (const bad of ['page=0', 'page=-4', 'page=abc', 'per_page=0', 'per_page=-1', 'per_page=xyz']) {
  const parsed = parsePagination(new URLSearchParams(bad));
  check(
    `"${bad}" falls back to a safe window`,
    parsed.page >= 1 && parsed.perPage >= 1 && parsed.perPage <= 100 && parsed.from >= 0,
    JSON.stringify(parsed),
  );
}

const meta = paginationMeta(third, 137);
check(
  'paginationMeta uses snake_case { page, per_page, total }',
  JSON.stringify(Object.keys(meta).sort()) === JSON.stringify(['page', 'per_page', 'total']) &&
    meta.page === 3 &&
    meta.per_page === 10 &&
    meta.total === 137,
  JSON.stringify(meta),
);
check('A null count becomes total 0', paginationMeta(defaults, null).total === 0);

// ---------------------------------------------------------------------------
// 6. Envelope shaping
// ---------------------------------------------------------------------------
console.log('\n— Response envelopes —');
const listEnvelope = apiData([{ id: 'a' }], meta);
check(
  'A list response is { data, meta }',
  JSON.stringify(Object.keys(listEnvelope.body).sort()) === JSON.stringify(['data', 'meta']) &&
    Array.isArray(listEnvelope.body.data) &&
    listEnvelope.body.meta.total === 137,
);
check('A list response defaults to 200', listEnvelope.status === 200);

const singleEnvelope = apiData({ id: 'a' });
check(
  'A single response is { data } with no meta key',
  JSON.stringify(Object.keys(singleEnvelope.body)) === JSON.stringify(['data']),
);
check('A create response can carry 201', apiData({ id: 'a' }, undefined, 201).status === 201);

const errorEnvelope = apiErrorResponse('not_found', 'Conversation not found.');
check(
  'An error is { error: { code, message } }',
  JSON.stringify(Object.keys(errorEnvelope.body)) === JSON.stringify(['error']) &&
    errorEnvelope.body.error.code === 'not_found' &&
    errorEnvelope.body.error.message === 'Conversation not found.',
);
check('Error envelopes never leak a data key', !('data' in errorEnvelope.body));

const EXPECTED_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  internal_error: 500,
};
for (const [code, status] of Object.entries(EXPECTED_STATUS)) {
  check(`${code} maps to HTTP ${status}`, apiErrorResponse(code, 'x').status === status);
}
check('An explicit status overrides the default', apiErrorResponse('not_found', 'x', 410).status === 410);

console.log('\n— ApiError —');
const apiErr = new ApiError('invalid_request', 'Bad input.');
check(
  'ApiError carries its code and mapped status',
  apiErr.code === 'invalid_request' && apiErr.status === 400 && apiErr.message === 'Bad input.',
);
// `instanceof Error` would compare against the sandbox's own realm, so the
// error-ness is asserted through cross-realm-safe properties instead.
check(
  'ApiError behaves like an Error (name + stack)',
  apiErr.name === 'ApiError' && typeof apiErr.stack === 'string',
);

check('parseIsoDate normalises a valid date', parseIsoDate('2026-01-02T03:04:05Z', 'since') === '2026-01-02T03:04:05.000Z');
check('parseIsoDate passes null through', parseIsoDate(null, 'since') === null);
let dateThrew = null;
try {
  parseIsoDate('not-a-date', 'since');
} catch (err) {
  dateThrew = err;
}
check(
  'parseIsoDate rejects junk with invalid_request',
  dateThrew && dateThrew.code === 'invalid_request' && dateThrew.status === 400,
  dateThrew ? dateThrew.message : 'did not throw',
);

// ---------------------------------------------------------------------------
// 7. JavaScript SDK (public/sdk/assistant.js) against a fake fetch
// ---------------------------------------------------------------------------
console.log('\n— JavaScript SDK —');
const { createRequire } = await import('node:module');
const AIAssistant = createRequire(import.meta.url)('../public/sdk/assistant.js');

let lastRequest = null;
function okFetch(payload) {
  return async (url, init) => {
    lastRequest = { url, init };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    };
  };
}

const sdkKey = generateApiKey().key;
const sdk = new AIAssistant({
  apiKey: sdkKey,
  baseUrl: 'https://example.test/',
  fetch: okFetch({ data: [{ id: 'a' }], meta: { page: 2, per_page: 10, total: 1 } }),
});

const listed = await sdk.conversations.list({ status: 'human_active', page: 2, channel: undefined });
check(
  'SDK builds the URL, trims the base slash and drops empty params',
  lastRequest.url === 'https://example.test/api/v1/conversations?status=human_active&page=2',
  lastRequest.url,
);
check('SDK sends the bearer header', lastRequest.init.headers.Authorization === `Bearer ${sdkKey}`);
check('SDK returns the parsed envelope', listed.meta.total === 1 && listed.data[0].id === 'a');

await sdk.messages.send({ conversation_id: 'c1', text: 'hi' });
check(
  'SDK posts JSON bodies',
  lastRequest.init.method === 'POST' &&
    lastRequest.init.headers['Content-Type'] === 'application/json' &&
    JSON.parse(lastRequest.init.body).text === 'hi',
);

let attempts = 0;
const flaky = async () => {
  attempts++;
  return {
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { code: 'not_configured', message: 'nope' } }),
  };
};
const retrying = new AIAssistant({ apiKey: sdkKey, baseUrl: 'https://example.test', fetch: flaky, maxRetries: 1 });
let sdkError = null;
try {
  await retrying.products.list();
} catch (err) {
  sdkError = err;
}
check('SDK retries a 5xx once when maxRetries is 1', attempts === 2, `${attempts} attempts`);
check(
  'SDK surfaces the API error code and status',
  sdkError && sdkError.name === 'AIAssistantError' && sdkError.code === 'not_configured' && sdkError.status === 503,
  sdkError ? sdkError.message : 'did not throw',
);

let noKeyThrew = false;
try {
  new AIAssistant({ baseUrl: 'https://example.test' });
} catch {
  noKeyThrew = true;
}
check('SDK refuses to construct without an apiKey', noKeyThrew);
check(
  'SDK exposes every documented namespace',
  ['conversations', 'messages', 'contacts', 'orders', 'products', 'broadcasts', 'analytics'].every(
    (ns) => sdk[ns] && typeof sdk[ns] === 'object',
  ),
);

// ---------------------------------------------------------------------------
// 8. Optional: round-trip a real api_keys row
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  console.log('\n⏭  DATABASE_URL not set — skipping the api_keys round-trip.');
} else {
  console.log('\n— Database round-trip —');
  const pg = (await import('pg')).default;

  async function buildClient() {
    const u = new URL(DATABASE_URL);
    let host = u.hostname;
    try {
      await dns.lookup(host);
    } catch {
      try {
        const a6 = await dns.resolve6(host);
        if (a6[0]) host = a6[0];
      } catch {
        const a4 = await dns.resolve4(host).catch(() => []);
        if (a4[0]) host = a4[0];
      }
    }
    return new pg.Client({
      host,
      port: Number(u.port) || 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1) || 'postgres',
      ssl: { rejectUnauthorized: false },
    });
  }

  const client = await buildClient();
  let companyId = null;
  try {
    await client.connect();

    const { rows: exists } = await client.query(
      "select to_regclass('public.api_keys') is not null as ok, to_regclass('public.api_request_logs') is not null as logs",
    );
    if (!exists[0]?.ok) {
      console.log('⏭  api_keys table missing — run `npm run db:migrate` first. Skipping.');
    } else {
      check('api_request_logs table exists', exists[0].logs === true);

      const company = await client.query(
        "insert into public.companies (name) values ('QA Public API') returning id",
      );
      companyId = company.rows[0].id;

      const live = generateApiKey();
      const expired = generateApiKey();
      const revoked = generateApiKey();

      await client.query(
        `insert into public.api_keys (company_id, name, key_prefix, key_hash, scopes)
         values ($1, 'live', $2, $3, $4)`,
        [companyId, live.keyPrefix, live.keyHash, ['contacts:read']],
      );
      await client.query(
        `insert into public.api_keys (company_id, name, key_prefix, key_hash, scopes, expires_at)
         values ($1, 'expired', $2, $3, $4, now() - interval '1 day')`,
        [companyId, expired.keyPrefix, expired.keyHash, ['*']],
      );
      await client.query(
        `insert into public.api_keys (company_id, name, key_prefix, key_hash, scopes, revoked_at)
         values ($1, 'revoked', $2, $3, $4, now())`,
        [companyId, revoked.keyPrefix, revoked.keyHash, ['*']],
      );

      // The lookup the library performs: narrow by prefix, then verify by hash.
      const found = await client.query(
        'select id, company_id, scopes, key_hash, expires_at, revoked_at from public.api_keys where key_prefix = $1',
        [live.keyPrefix],
      );
      const match = found.rows.find((row) => verifyApiKeyHash(live.key, row.key_hash));
      check('A stored key is found by prefix and verified by hash', Boolean(match));
      check('The row resolves to the owning company', match?.company_id === companyId);
      check(
        'Scopes round-trip as a text[]',
        Array.isArray(match?.scopes) && match.scopes[0] === 'contacts:read',
        JSON.stringify(match?.scopes),
      );
      check('The stored row is usable', match ? isKeyUsable(match) : false);

      const expiredRow = (
        await client.query('select expires_at, revoked_at from public.api_keys where key_prefix = $1', [
          expired.keyPrefix,
        ])
      ).rows[0];
      check(
        'An expired stored key is rejected',
        !isKeyUsable({
          revoked_at: expiredRow.revoked_at,
          expires_at: expiredRow.expires_at?.toISOString?.() ?? expiredRow.expires_at,
        }),
      );

      const revokedRow = (
        await client.query('select expires_at, revoked_at from public.api_keys where key_prefix = $1', [
          revoked.keyPrefix,
        ])
      ).rows[0];
      check(
        'A revoked stored key is rejected',
        !isKeyUsable({
          revoked_at: revokedRow.revoked_at?.toISOString?.() ?? revokedRow.revoked_at,
          expires_at: revokedRow.expires_at,
        }),
      );

      check(
        'The plaintext key is nowhere in the row',
        !JSON.stringify(found.rows).includes(live.key.slice(9)),
      );

      // Revoking the live key must make it unusable without deleting it.
      await client.query('update public.api_keys set revoked_at = now() where id = $1', [match.id]);
      const after = (
        await client.query('select revoked_at from public.api_keys where id = $1', [match.id])
      ).rows[0];
      check(
        'Revoking flips the key to unusable and keeps the row',
        Boolean(after) &&
          !isKeyUsable({
            revoked_at: after.revoked_at?.toISOString?.() ?? after.revoked_at,
            expires_at: null,
          }),
      );

      // A request log row references the key and the company.
      await client.query(
        `insert into public.api_request_logs (company_id, api_key_id, method, path, status, duration_ms, ip)
         values ($1, $2, 'GET', '/api/v1/contacts', 200, 12, '127.0.0.1')`,
        [companyId, match.id],
      );
      const logged = await client.query(
        'select method, path, status from public.api_request_logs where company_id = $1',
        [companyId],
      );
      check(
        'A request log row round-trips',
        logged.rows.length === 1 && logged.rows[0].status === 200,
        JSON.stringify(logged.rows[0] ?? {}),
      );

      const catalogue = await client.query('select event from public.webhook_event_types');
      check(
        'The webhook event catalogue is seeded',
        catalogue.rows.length >= 8 &&
          catalogue.rows.some((r) => r.event === 'contact.created') &&
          catalogue.rows.some((r) => r.event === 'lead.created'),
        `${catalogue.rows.length} events`,
      );
    }
  } catch (err) {
    console.error('❌ Database round-trip error:', err.message);
    failures++;
  } finally {
    try {
      if (companyId) await client.query('delete from public.companies where id = $1', [companyId]);
      console.log('🧹 Cleaned up the test company (keys and logs cascade).');
    } catch (err) {
      console.error('cleanup warning:', err.message);
    }
    try {
      await client.end();
    } catch {}
  }
}

console.log(
  failures === 0 ? '\n🎉 All public API checks passed.' : `\n❌ ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
