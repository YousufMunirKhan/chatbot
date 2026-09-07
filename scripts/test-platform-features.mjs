// Platform features verification (migration 0057): white-label branding,
// group membership helpers, auto credit top-up, and the i18n layer.
//
// Runs with NO network and NO database. The libraries under test are real
// TypeScript source — they are transpiled here with the `typescript` package
// already in devDependencies, and their `@/lib/...` imports are rewritten to
// stubs. That is deliberately not a re-implementation of the logic: the tenant
// checks, the top-up claim and the failure cutoff are exercised as shipped, so
// this test fails if any of them is edited wrongly.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------------------
// Loader: real .ts source → importable ESM, with `@/lib/...` pointed at stubs
// ---------------------------------------------------------------------------
const OUT = join(tmpdir(), `platform-features-${process.pid}`);
mkdirSync(OUT, { recursive: true });

const STUBS = {
  '@/lib/db/server': './__db.mjs',
  '@/lib/logger': './__logger.mjs',
  '@/lib/platform-settings': './__stripe.mjs',
};

writeFileSync(
  join(OUT, '__db.mjs'),
  `export function createSupabaseServiceClient() {
     if (!globalThis.__DB) throw new Error('No fake DB installed');
     return globalThis.__DB;
   }\n`,
);
writeFileSync(
  join(OUT, '__logger.mjs'),
  `export const logger = { debug(){}, info(){}, warn(){}, error(){} };\n`,
);
writeFileSync(
  join(OUT, '__stripe.mjs'),
  `export async function getPlatformStripeSettings() {
     return globalThis.__STRIPE ?? { enabled: true, secretKey: 'sk_test_fake', publishableKey: null, webhookSecret: null };
   }\n`,
);

function compile(srcPath, outName, relMap = {}) {
  const source = readFileSync(srcPath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Rewrite every module specifier: aliases to the stubs above, relative
  // imports to the .mjs names this loader writes.
  const rewritten = js.replace(/from\s+['"]([^'"]+)['"]/g, (match, spec) => {
    const mapped = STUBS[spec] ?? relMap[spec];
    return mapped ? `from '${mapped}'` : match;
  });
  const outPath = join(OUT, outName);
  writeFileSync(outPath, rewritten);
  return pathToFileURL(outPath).href;
}

const SRC = (...parts) => join(process.cwd(), 'src', ...parts);

const enUrl = compile(SRC('lib', 'i18n', 'en.ts'), 'en.mjs');
compile(SRC('lib', 'i18n', 'ar.ts'), 'ar.mjs', { './en': './en.mjs' });
const i18nUrl = compile(SRC('lib', 'i18n', 'index.ts'), 'i18n.mjs', {
  './en': './en.mjs',
  './ar': './ar.mjs',
});
const agencyUrl = compile(SRC('lib', 'agency.ts'), 'agency.mjs');
const groupsUrl = compile(SRC('lib', 'groups.ts'), 'groups.mjs');
const topupUrl = compile(SRC('lib', 'billing', 'auto-topup.ts'), 'auto-topup.mjs');

// ---------------------------------------------------------------------------
// A fake PostgREST client covering exactly the chains these libraries use.
// ---------------------------------------------------------------------------
function matchesOr(row, expr) {
  // "claimed_at.is.null,claimed_at.lt.2020-01-01T00:00:00.000Z"
  return expr.split(',').some((clause) => {
    const first = clause.indexOf('.');
    const second = clause.indexOf('.', first + 1);
    const col = clause.slice(0, first);
    const op = clause.slice(first + 1, second);
    const value = clause.slice(second + 1);
    if (op === 'is') return value === 'null' ? row[col] == null : row[col] === value;
    if (op === 'lt') return row[col] != null && String(row[col]) < value;
    if (op === 'gte') return row[col] != null && String(row[col]) >= value;
    return false;
  });
}

function makeDb(tables) {
  const store = JSON.parse(JSON.stringify(tables));
  const stats = { queries: 0, inserts: [] };

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.payload = null;
    }
    _rows() {
      const rows = store[this.table] ?? [];
      return rows.filter((row) =>
        this.filters.every((f) => {
          if (f.kind === 'eq') return row[f.col] === f.value;
          if (f.kind === 'in') return f.value.includes(row[f.col]);
          if (f.kind === 'gte') return String(row[f.col] ?? '') >= String(f.value);
          if (f.kind === 'or') return matchesOr(row, f.value);
          return true;
        }),
      );
    }
    select() {
      return this;
    }
    eq(col, value) {
      this.filters.push({ kind: 'eq', col, value });
      return this;
    }
    in(col, value) {
      this.filters.push({ kind: 'in', col, value });
      return this;
    }
    gte(col, value) {
      this.filters.push({ kind: 'gte', col, value });
      return this;
    }
    or(value) {
      this.filters.push({ kind: 'or', value });
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    insert(payload) {
      this.op = 'insert';
      this.payload = payload;
      return this;
    }
    update(payload) {
      this.op = 'update';
      this.payload = payload;
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    _run() {
      stats.queries++;
      if (this.op === 'insert') {
        store[this.table] = store[this.table] ?? [];
        store[this.table].push({ ...this.payload });
        stats.inserts.push({ table: this.table, row: this.payload });
        return { data: [this.payload], error: null };
      }
      const rows = this._rows();
      if (this.op === 'update') {
        for (const row of rows) Object.assign(row, this.payload);
        return { data: rows, error: null };
      }
      if (this.op === 'delete') {
        store[this.table] = (store[this.table] ?? []).filter((r) => !rows.includes(r));
        return { data: rows, error: null };
      }
      return { data: rows, error: null };
    }
    async maybeSingle() {
      const { data, error } = this._run();
      return { data: data[0] ?? null, error };
    }
    then(resolve, reject) {
      return Promise.resolve(this._run()).then(resolve, reject);
    }
  }

  return {
    client: { from: (table) => new Query(table) },
    store,
    stats,
  };
}

// ===========================================================================
const run = async () => {
  const { en } = await import(enUrl);
  const i18n = await import(i18nUrl);
  const agency = await import(agencyUrl);
  const groups = await import(groupsUrl);
  const topup = await import(topupUrl);

  // -------------------------------------------------------------------------
  console.log('\n— Branding —');
  // -------------------------------------------------------------------------
  const defaults = agency.normalizeBranding(null);
  check('normalizeBranding(null) returns the platform defaults',
    defaults.productName === agency.DEFAULT_BRANDING.productName &&
      defaults.primaryColor === '#2563eb' &&
      defaults.logoUrl === null &&
      defaults.hidePoweredBy === false);

  const partial = agency.normalizeBranding({ productName: 'Acme Chat', hidePoweredBy: true });
  check('normalizeBranding fills the gaps around a partial object',
    partial.productName === 'Acme Chat' &&
      partial.hidePoweredBy === true &&
      partial.primaryColor === '#2563eb');

  const hostile = agency.normalizeBranding({
    primaryColor: 'red; background:url(x)',
    logoUrl: 'javascript:alert(1)',
    loginBackground: 'data:text/html,<script>',
  });
  check('normalizeBranding rejects a non-hex colour', hostile.primaryColor === '#2563eb');
  check('normalizeBranding drops javascript: and data: image URLs',
    hostile.logoUrl === null && hostile.loginBackground === null);
  check('normalizeBranding keeps an https logo',
    agency.normalizeBranding({ logoUrl: 'https://cdn.acme.test/logo.png' }).logoUrl ===
      'https://cdn.acme.test/logo.png');

  check('normalizeHost strips port and www', agency.normalizeHost('WWW.Acme.TEST:3000') === 'acme.test');
  check('normalizeHost on empty input is null', agency.normalizeHost('') === null);

  const AGENCY_ROW = {
    id: 'ag-1',
    name: 'Acme Digital',
    slug: 'acme-digital',
    owner_user_id: 'user-1',
    branding_json: {
      productName: 'Acme Chat',
      primaryColor: '#16a34a',
      logoUrl: 'https://cdn.acme.test/logo.png',
      hidePoweredBy: true,
    },
    custom_domain: 'app.acme.test',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  // No agency → defaults.
  let db = makeDb({ agency_companies: [], agencies: [] });
  globalThis.__DB = db.client;
  agency.invalidateAgencyCache();
  const plain = await agency.resolveBranding('company-none');
  check('resolveBranding falls back to defaults with no agency',
    plain.productName === agency.DEFAULT_BRANDING.productName && plain.logoUrl === null);

  // Attached to an agency → override.
  db = makeDb({
    agency_companies: [{ agency_id: 'ag-1', company_id: 'company-a' }],
    agencies: [AGENCY_ROW],
  });
  globalThis.__DB = db.client;
  agency.invalidateAgencyCache();
  const branded = await agency.resolveBranding('company-a');
  check('resolveBranding uses the agency branding',
    branded.productName === 'Acme Chat' &&
      branded.primaryColor === '#16a34a' &&
      branded.hidePoweredBy === true);

  const queriesAfterFirst = db.stats.queries;
  await agency.resolveBranding('company-a');
  check('resolveBranding is memoised (no second round trip)',
    db.stats.queries === queriesAfterFirst);

  agency.invalidateAgencyCache();
  const byDomain = await agency.getAgencyByDomain('https://www.app.acme.test'.replace('https://', ''));
  check('getAgencyByDomain resolves the custom domain', byDomain?.id === 'ag-1');
  check('getAgencyByDomain on an unknown host is null',
    (await agency.getAgencyByDomain('someone-else.test')) === null);

  // A deactivated agency must stop branding its tenants.
  db = makeDb({
    agency_companies: [{ agency_id: 'ag-1', company_id: 'company-a' }],
    agencies: [{ ...AGENCY_ROW, is_active: false }],
  });
  globalThis.__DB = db.client;
  agency.invalidateAgencyCache();
  const deactivated = await agency.resolveBranding('company-a');
  check('a deactivated agency falls back to platform branding',
    deactivated.productName === agency.DEFAULT_BRANDING.productName);

  // -------------------------------------------------------------------------
  console.log('\n— Groups —');
  // -------------------------------------------------------------------------
  db = makeDb({
    agent_groups: [
      { id: 'g-1', company_id: 'co-a', name: 'Support' },
      { id: 'g-other', company_id: 'co-b', name: 'Their team' },
    ],
    agent_group_members: [
      { group_id: 'g-1', user_id: 'u-1' },
      { group_id: 'g-1', user_id: 'u-2' },
      { group_id: 'g-other', user_id: 'u-9' },
    ],
    contact_groups: [
      { id: 'cg-1', company_id: 'co-a', name: 'VIP' },
      { id: 'cg-other', company_id: 'co-b', name: 'Theirs' },
    ],
    contact_group_members: [
      { group_id: 'cg-1', contact_type: 'lead', contact_id: 'lead-1' },
      { group_id: 'cg-1', contact_type: 'lead', contact_id: 'lead-2' },
      { group_id: 'cg-1', contact_type: 'synced_customer', contact_id: 'cust-1' },
      { group_id: 'cg-other', contact_type: 'lead', contact_id: 'lead-99' },
    ],
  });
  globalThis.__DB = db.client;

  const memberIds = await groups.listGroupMemberIds('co-a', 'g-1');
  check('listGroupMemberIds returns the group members',
    memberIds.length === 2 && memberIds.includes('u-1') && memberIds.includes('u-2'));
  check('listGroupMemberIds is empty for another tenant\'s group',
    (await groups.listGroupMemberIds('co-a', 'g-other')).length === 0);
  check('listGroupMemberIds is empty for a missing group',
    (await groups.listGroupMemberIds('co-a', 'g-nope')).length === 0);

  const contactIds = await groups.contactIdsInGroup('co-a', 'cg-1');
  check('contactIdsInGroup returns every contact kind by default', contactIds.length === 3);
  const leadIds = await groups.contactIdsInGroup('co-a', 'cg-1', 'lead');
  check('contactIdsInGroup filters by contact type',
    leadIds.length === 2 && !leadIds.includes('cust-1'));
  check('contactIdsInGroup is empty across tenants',
    (await groups.contactIdsInGroup('co-a', 'cg-other')).length === 0);
  const refs = await groups.contactRefsInGroup('co-a', 'cg-1');
  check('contactRefsInGroup keeps the contact kind',
    refs.some((r) => r.type === 'synced_customer' && r.id === 'cust-1'));

  // -------------------------------------------------------------------------
  console.log('\n— Auto top-up: the decision —');
  // -------------------------------------------------------------------------
  const cfg = (over = {}) => ({
    companyId: 'co-a',
    isEnabled: true,
    thresholdCredits: 5,
    topupAmountCents: 2000,
    stripePaymentMethodId: 'pm_test',
    lastTopupAt: null,
    failureCount: 0,
    disabledReason: null,
    claimedAt: null,
    ...over,
  });

  check('no settings → not_configured',
    topup.autoTopUpDecision(null, 1).status === 'not_configured');
  check('disabled → no attempt',
    topup.autoTopUpDecision(cfg({ isEnabled: false }), 0).attempt === false);
  check('no saved card → not_configured',
    topup.autoTopUpDecision(cfg({ stripePaymentMethodId: null }), 0).status === 'not_configured');
  check('balance above the threshold → no attempt',
    topup.autoTopUpDecision(cfg(), 5.01).status === 'above_threshold');
  check('balance exactly at the threshold → attempt',
    topup.autoTopUpDecision(cfg(), 5).attempt === true);
  check('balance below the threshold → attempt',
    topup.autoTopUpDecision(cfg(), 0.4).attempt === true);
  check(`${topup.MAX_CONSECUTIVE_FAILURES} failures already recorded → disabled, no attempt`,
    topup.autoTopUpDecision(cfg({ failureCount: topup.MAX_CONSECUTIVE_FAILURES }), 0).status ===
      'disabled');
  check('2 failures still attempts',
    topup.autoTopUpDecision(cfg({ failureCount: 2 }), 0).attempt === true);

  check('a fresh claim is not stale', topup.isClaimStale(new Date().toISOString()) === false);
  check('an expired claim is stale',
    topup.isClaimStale(new Date(Date.now() - topup.CLAIM_TTL_MS - 1000).toISOString()) === true);
  check('no claim is stale', topup.isClaimStale(null) === true);

  // -------------------------------------------------------------------------
  console.log('\n— Auto top-up: charging —');
  // -------------------------------------------------------------------------
  const topUpDb = (over = {}) =>
    makeDb({
      company_auto_topup: [
        {
          company_id: 'co-a',
          is_enabled: true,
          threshold_credits: 5,
          topup_amount_cents: 2000,
          stripe_payment_method_id: 'pm_test',
          last_topup_at: null,
          failure_count: 0,
          disabled_reason: null,
          claimed_at: null,
          ...over,
        },
      ],
      company_credit_accounts: [
        { company_id: 'co-a', balance_amount: 1.25, lifetime_credit_added: 10 },
      ],
      subscriptions: [{ company_id: 'co-a', stripe_customer_id: 'cus_test' }],
      company_credit_transactions: [],
      company_auto_topup_attempts: [],
    });

  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  const stripeOk = async () => {
    fetchCalls++;
    return { ok: true, status: 200, json: async () => ({ id: 'pi_1', status: 'succeeded' }) };
  };
  const stripeDeclined = async () => {
    fetchCalls++;
    return {
      ok: false,
      status: 402,
      json: async () => ({ error: { message: 'Your card was declined.' } }),
    };
  };

  try {
    // --- success path ---
    db = topUpDb();
    globalThis.__DB = db.client;
    fetchCalls = 0;
    globalThis.fetch = stripeOk;
    let result = await topup.maybeAutoTopUp('co-a');
    check('a low balance charges the saved card', result.status === 'charged' && fetchCalls === 1);
    check('the ledger balance goes up by the top-up amount',
      db.store.company_credit_accounts[0].balance_amount === 21.25);
    check('a top_up transaction is written',
      db.store.company_credit_transactions.length === 1 &&
        db.store.company_credit_transactions[0].type === 'top_up' &&
        db.store.company_credit_transactions[0].amount === 20);
    check('a succeeded attempt is recorded',
      db.store.company_auto_topup_attempts[0]?.status === 'succeeded');
    check('the claim is released and last_topup_at set',
      db.store.company_auto_topup[0].claimed_at === null &&
        db.store.company_auto_topup[0].last_topup_at !== null);

    // --- above threshold: nothing is charged ---
    db = topUpDb();
    db.store.company_credit_accounts[0].balance_amount = 50;
    globalThis.__DB = db.client;
    fetchCalls = 0;
    result = await topup.maybeAutoTopUp('co-a');
    check('a healthy balance charges nothing',
      result.status === 'above_threshold' && fetchCalls === 0);

    // --- no double charge: a held claim blocks a second run ---
    db = topUpDb({ claimed_at: new Date().toISOString() });
    globalThis.__DB = db.client;
    fetchCalls = 0;
    globalThis.fetch = stripeOk;
    result = await topup.maybeAutoTopUp('co-a');
    check('a live claim blocks a concurrent run',
      result.status === 'already_running' && fetchCalls === 0);

    // --- no double charge: two overlapping callers ---
    db = topUpDb();
    globalThis.__DB = db.client;
    fetchCalls = 0;
    const [a, b] = await Promise.all([topup.maybeAutoTopUp('co-a'), topup.maybeAutoTopUp('co-a')]);
    const outcomes = [a.status, b.status].sort().join(',');
    check('two overlapping callers charge exactly once',
      fetchCalls === 1 && outcomes === 'already_running,charged');
    check('the balance moved once, not twice',
      db.store.company_credit_accounts[0].balance_amount === 21.25);

    // --- a stale claim is takeable ---
    db = topUpDb({
      claimed_at: new Date(Date.now() - topup.CLAIM_TTL_MS - 60_000).toISOString(),
    });
    globalThis.__DB = db.client;
    fetchCalls = 0;
    result = await topup.maybeAutoTopUp('co-a');
    check('a claim left by a dead process is retaken', result.status === 'charged');

    // --- failures accumulate, then switch the feature off ---
    db = topUpDb();
    globalThis.__DB = db.client;
    fetchCalls = 0;
    globalThis.fetch = stripeDeclined;

    result = await topup.maybeAutoTopUp('co-a');
    check('a declined card fails the attempt', result.status === 'failed');
    check('failure 1 counted, still enabled',
      db.store.company_auto_topup[0].failure_count === 1 &&
        db.store.company_auto_topup[0].is_enabled === true);

    await topup.maybeAutoTopUp('co-a');
    check('failure 2 counted, still enabled',
      db.store.company_auto_topup[0].failure_count === 2 &&
        db.store.company_auto_topup[0].is_enabled === true);

    await topup.maybeAutoTopUp('co-a');
    check(`failure ${topup.MAX_CONSECUTIVE_FAILURES} turns auto top-up off`,
      db.store.company_auto_topup[0].failure_count === 3 &&
        db.store.company_auto_topup[0].is_enabled === false);
    check('the reason for switching off is recorded',
      typeof db.store.company_auto_topup[0].disabled_reason === 'string' &&
        db.store.company_auto_topup[0].disabled_reason.includes('declined'));
    check('every failed attempt is recorded',
      db.store.company_auto_topup_attempts.length === 3 &&
        db.store.company_auto_topup_attempts.every((a) => a.status === 'failed'));
    check('no credit was added on failure',
      db.store.company_credit_accounts[0].balance_amount === 1.25 &&
        db.store.company_credit_transactions.length === 0);

    const callsBefore = fetchCalls;
    result = await topup.maybeAutoTopUp('co-a');
    check('once disabled it stops calling Stripe at all',
      result.status === 'disabled' && fetchCalls === callsBefore);

    // --- a success clears the streak ---
    db = topUpDb({ failure_count: 2 });
    globalThis.__DB = db.client;
    globalThis.fetch = stripeOk;
    await topup.maybeAutoTopUp('co-a');
    check('a successful charge resets the failure streak',
      db.store.company_auto_topup[0].failure_count === 0);

    // --- missing Stripe configuration fails safely ---
    db = topUpDb();
    globalThis.__DB = db.client;
    globalThis.__STRIPE = { enabled: false, secretKey: null };
    fetchCalls = 0;
    result = await topup.maybeAutoTopUp('co-a');
    check('no Stripe configuration fails without a network call',
      result.status === 'failed' && fetchCalls === 0);
    check('the claim is released after a failure',
      db.store.company_auto_topup[0].claimed_at === null);
    globalThis.__STRIPE = undefined;
  } finally {
    globalThis.fetch = realFetch;
  }

  // -------------------------------------------------------------------------
  console.log('\n— i18n —');
  // -------------------------------------------------------------------------
  const enDict = i18n.getDictionary('en');
  const arDict = i18n.getDictionary('ar');

  check('normalizeLocale maps ar', i18n.normalizeLocale('ar') === 'ar');
  check('normalizeLocale maps auto to English', i18n.normalizeLocale('auto') === 'en');
  check('normalizeLocale maps null to English', i18n.normalizeLocale(null) === 'en');
  check('dirFor(ar) is rtl', i18n.dirFor('ar') === 'rtl');
  check('dirFor(auto) is ltr', i18n.dirFor('auto') === 'ltr');

  check('t returns the English string', i18n.t(enDict, 'inbox.title') === 'Inbox');
  check('t returns the Arabic string', i18n.t(arDict, 'inbox.title') === 'صندوق الوارد');

  check('t interpolates a {var}',
    i18n.t(enDict, 'inbox.assigned', { name: 'Sara' }) === 'Assigned to Sara');
  check('t interpolates several vars',
    i18n.t(enDict, 'home.step.progress', { current: 2, total: 5 }) === 'Step 2 of 5');
  check('t interpolates in Arabic too',
    i18n.t(arDict, 'home.step.progress', { current: 2, total: 5 }).includes('2') &&
      i18n.t(arDict, 'home.step.progress', { current: 2, total: 5 }).includes('5'));
  check('an unsupplied placeholder is left visible',
    i18n.t(enDict, 'inbox.assigned', {}) === 'Assigned to {name}');

  const holey = { ...arDict };
  delete holey['common.save'];
  check('a missing translation falls back to English',
    i18n.t(holey, 'common.save') === 'Save');
  check('an unknown key falls back to the key itself',
    i18n.t(enDict, 'nope.not.a.key') === 'nope.not.a.key');
  check('t never returns undefined', typeof i18n.t(enDict, 'also.missing') === 'string');

  check('tOr keeps the caller\'s fallback for an unknown key',
    i18n.tOr(arDict, 'nav.company.nowhere', 'Nowhere') === 'Nowhere');
  check('tOr translates a known key',
    i18n.tOr(arDict, 'nav.company.inbox', 'Inbox') === 'صندوق الوارد');

  check('navKey derives a nested key', i18n.navKey('/company/inbox') === 'nav.company.inbox');
  check('navKey derives a root key', i18n.navKey('/company') === 'nav.company');
  check('navKey tolerates a trailing slash',
    i18n.navKey('/super-admin/agencies/') === 'nav.super-admin.agencies');

  // Parity — the reason `ar.ts` is typed as Record<keyof typeof en, string>.
  const enKeys = Object.keys(en);
  const arKeys = Object.keys(arDict);
  const missingInAr = enKeys.filter((k) => !(k in arDict));
  const extraInAr = arKeys.filter((k) => !(k in en));
  check(`every English key exists in Arabic (${enKeys.length} keys)`, missingInAr.length === 0);
  if (missingInAr.length) console.log('   missing:', missingInAr.join(', '));
  check('Arabic has no keys English does not', extraInAr.length === 0);
  if (extraInAr.length) console.log('   extra:', extraInAr.join(', '));

  const untranslated = enKeys.filter((k) => arDict[k] === en[k] && /[A-Za-z]{4}/.test(en[k]));
  check('no Arabic value is a copy of its English sentence', untranslated.length === 0);
  if (untranslated.length) console.log('   copied:', untranslated.join(', '));

  const notArabic = enKeys.filter((k) => !/[؀-ۿ]/.test(arDict[k]));
  check('every Arabic value contains Arabic script', notArabic.length === 0);
  if (notArabic.length) console.log('   not Arabic:', notArabic.join(', '));

  check('navigation labels are covered',
    ['nav.company', 'nav.company.inbox', 'nav.company.settings', 'nav.super-admin'].every(
      (k) => k in en,
    ));
  check('common buttons are covered',
    ['common.save', 'common.cancel', 'common.delete', 'common.create', 'common.search',
     'common.export', 'common.active', 'common.paused'].every((k) => k in en));
  check('table headers are covered',
    ['table.name', 'table.status', 'table.created', 'table.actions'].every((k) => k in en));
  check('validation words are covered',
    ['validation.required', 'validation.invalid_email', 'validation.min'].every((k) => k in en));
  check('empty states are covered',
    ['empty.nothing_here', 'empty.no_results'].every((k) => k in en));
};

run()
  .catch((err) => {
    console.error('❌ Test run error:', err?.stack ?? err);
    failures++;
  })
  .finally(() => {
    rmSync(OUT, { recursive: true, force: true });
    console.log(
      failures === 0
        ? '\n🎉 Platform features verified (agency branding, groups, auto top-up, i18n).'
        : `\n❌ ${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
