/**
 * Round-trip budget for the two heaviest company pages.
 *
 * WHY THIS EXISTS
 * The application server and its Postgres are in different places, and a single
 * database round trip measured 229 ms on production regardless of what it asked
 * for (`select 1` on a warm connection: 229 ms; PostgREST `select id from
 * companies limit 1`: 263 ms). Query shape is therefore almost irrelevant and
 * the NUMBER OF ROUND TRIPS is the whole cost model: one extra `.from()` is a
 * quarter of a second of blank screen.
 *
 * A regression here does not look like a bug. It looks like someone adding a
 * perfectly reasonable second query to a reader, and the inbox quietly getting
 * a second slower. So the count is asserted rather than trusted.
 *
 * HOW IT WORKS
 * The real reader modules are transpiled and imported (scripts/lib/ts-load.mjs)
 * with `@/lib/db/server` swapped for a fake Supabase client that records every
 * `.from()`, `.rpc()` and `auth.getUser()`. `react`'s `cache()` is replaced with
 * an equivalent per-scope memo so request-level deduplication is measured the
 * same way Next.js does it. No database is involved.
 */
import { loadTs, makeChecker } from './lib/ts-load.mjs';

// ---------------------------------------------------------------------------
// Ceilings. Raise one only with a measurement and a reason.
// ---------------------------------------------------------------------------
const BUDGET = {
  /**
   * Auth guard: `auth.getUser()` plus ONE embedded read of the user's profile,
   * 2FA state and membership. (The separate-query fallback in `getSessionUser`
   * costs 4; this asserts the embed is the path being taken.)
   */
  session: 2,
  /** Inbox page: guard + list + queue counts + support settings + dictionary. */
  inbox: 12,
  /** Home page: guard + dashboard summary + setup progress. */
  dashboard: 13,
};

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const CONVERSATION_IDS = Array.from(
  { length: 25 },
  (_, i) => `00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
);

// ---------------------------------------------------------------------------
// Stub sources handed to the transpiler.
// ---------------------------------------------------------------------------

const dbStub = `
const RT = (globalThis.__RT ??= { calls: [], gen: 0, fixtures: {} });

function result(state) {
  const fixture = RT.fixtures[state.table];
  const value = typeof fixture === 'function' ? fixture(state) : fixture;
  if (value === undefined) return { data: [], count: 0, error: null };
  return { count: null, error: null, ...value };
}

function builder(table) {
  const state = { table, head: false, wantCount: false, filters: [] };
  const b = {
    select(columns, options) {
      state.columns = String(columns ?? '');
      if (options && options.head) state.head = true;
      if (options && options.count) state.wantCount = true;
      return b;
    },
    then(resolve, reject) {
      return Promise.resolve(result(state)).then(resolve, reject);
    },
    maybeSingle() {
      const r = result(state);
      const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
      return Promise.resolve({ data, count: r.count, error: r.error });
    },
    single() {
      return b.maybeSingle();
    },
  };
  b.__state = state;
  for (const method of [
    'eq','neq','in','not','is','gte','gt','lte','lt','ilike','like','or','order',
    'range','limit','contains','filter','match','overlaps','textSearch','csv',
  ]) {
    b[method] = (...args) => {
      state.filters.push([method, ...args]);
      return b;
    };
  }
  return b;
}

function rpcBuilder(name, args) {
  const load = () => {
    const fixture = RT.fixtures['rpc:' + name];
    const value = typeof fixture === 'function' ? fixture(args) : fixture;
    if (value === undefined) return { data: null, count: null, error: { message: 'no fixture for rpc ' + name } };
    return { count: null, error: null, ...value };
  };
  const b = {
    then: (resolve, reject) => Promise.resolve(load()).then(resolve, reject),
    maybeSingle: () => {
      const r = load();
      const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
      return Promise.resolve({ data, count: r.count, error: r.error });
    },
    single() { return b.maybeSingle(); },
    select: () => b,
  };
  return b;
}

function client() {
  return {
    from(table) {
      const b = builder(table);
      // The state object is pushed by reference so the filters chained after
      // this point are visible to the tenant-scope assertions.
      RT.calls.push({ kind: 'from', name: table, state: b.__state });
      return b;
    },
    rpc(name, args) {
      RT.calls.push({ kind: 'rpc', name, args: args ?? {} });
      return rpcBuilder(name, args);
    },
  };
}

export function createSupabaseServiceClient() {
  return client();
}

export function createSupabaseServerClient() {
  const base = client();
  base.auth = {
    getUser: async () => {
      RT.calls.push({ kind: 'auth', name: 'getUser' });
      return { data: { user: RT.fixtures.__user ?? null }, error: null };
    },
  };
  return base;
}
`;

/**
 * React's `cache()` memoises for the lifetime of one server request. `gen` is
 * bumped between scenarios to stand in for "next request".
 */
const reactStub = `
const RT = (globalThis.__RT ??= { calls: [], gen: 0, fixtures: {} });
export function cache(fn) {
  let generation = -1;
  let store = new Map();
  return (...args) => {
    if (generation !== RT.gen) {
      generation = RT.gen;
      store = new Map();
    }
    const key = JSON.stringify(args ?? []);
    if (!store.has(key)) store.set(key, fn(...args));
    return store.get(key);
  };
}
`;

const stubs = {
  '@/lib/db/server': dbStub,
  react: reactStub,
  '@/lib/auth': `export * from './src__lib__auth__index.mjs';`,
  '@/lib/company/company-core': `export * from './src__lib__company__company-core.mjs';`,
  '@/lib/constants': `
    export const ROLES = { SUPER_ADMIN: 'super_admin', COMPANY_ADMIN: 'company_admin', AGENT: 'agent' };
    // setup-data.ts reads its step titles from here, so the stub has to carry
    // the same keys — the real list lives in src/lib/constants.ts.
    export const SETUP_STEPS = [
      { key: 'website', title: '', description: '' },
      { key: 'purpose', title: '', description: '' },
      { key: 'capabilities', title: '', description: '' },
      { key: 'required-data', title: '', description: '' },
      { key: 'test', title: '', description: '' },
      { key: 'install', title: '', description: '' },
    ];
    export const SETUP_STEP_COPY = Object.fromEntries(
      SETUP_STEPS.map((s) => [s.key, { title: s.title, description: s.description }]),
    );
  `,
  '@/lib/impersonation': `export const IMPERSONATION_COOKIE = 'aiba_impersonation_session';`,
  // `data.ts` resolves each member's effective permissions now. The real module
  // reads no database, so the stub only has to satisfy the shape the callers
  // spread and count — grant everything, so nothing this test measures is
  // filtered out by a permission it was never about.
  '@/lib/permissions': `
    export const PERMISSIONS = ['inbox.read'];
    export const ROLE_PERMISSIONS = {};
    export function resolvePermissions() { return new Set(PERMISSIONS); }
    export function normalizePermissionOverrides() { return {}; }
    export function roleRank() { return 0; }
    export function isAssignableRole() { return true; }
  `,
  '@/lib/errors': `
    export class AppError extends Error {}
    export class UnauthorizedError extends AppError {}
    export class ForbiddenError extends AppError {}
    export class NotFoundError extends AppError {}
    export class RateLimitError extends AppError {}
    export class PlanLimitError extends AppError {}
  `,
  '@/lib/quick-actions-format': `
    export function humanizeStoredSubmission(value) { return String(value ?? ''); }
    export function fieldLabel(key) { return String(key); }
  `,
  '@/lib/tickets/ticket-number': `
    export function ticketNumberFromState() { return 'T-1001'; }
    export async function allocateTicketNumber() { return 'T-1001'; }
  `,
  'next/navigation': `
    export function redirect(url) { throw new Error('unexpected redirect to ' + url); }
    export function notFound() { throw new Error('unexpected notFound()'); }
  `,
  'next/headers': `
    export function cookies() {
      return { get: () => undefined, getAll: () => [], set() {}, delete() {} };
    }
    export function headers() { return new Map(); }
  `,
};

const ENTRIES = [
  'src/lib/auth/index.ts',
  'src/lib/company/company-core.ts',
  'src/lib/i18n/server.ts',
  'src/modules/company/data.ts',
  'src/modules/company/inbox-data.ts',
  'src/modules/company/dashboard-data.ts',
  'src/modules/company/setup-data.ts',
  'src/modules/company/support-settings-data.ts',
];

// ---------------------------------------------------------------------------
// Fixtures. Shaped so the readers take their real code paths (a full page of
// conversations, a resolvable company, a signed-in company admin).
// ---------------------------------------------------------------------------
function installFixtures() {
  const RT = globalThis.__RT;
  const conversationRows = CONVERSATION_IDS.map((id) => ({
    id,
    company_id: COMPANY_ID,
    status: 'needs_human',
    channel: 'web_chat',
    language: 'en',
    visitor_id: 'v-' + id.slice(-2),
    unread_count: 1,
    started_at: '2026-01-01T00:00:00.000Z',
    last_message_at: '2026-01-02T00:00:00.000Z',
    closed_at: null,
    ai_enabled: true,
    assigned_agent_id: null,
    first_agent_reply_at: null,
    csat_rating: null,
    priority: 'normal',
    tags: [],
    state_json: {},
  }));

  RT.fixtures = {
    __user: { id: USER_ID, email: 'agent@example.com' },
    companies: { data: [{ id: COMPANY_ID, name: 'Acme', default_language: 'en', status: 'active', timezone: 'UTC', subscriptions: {} }] },
    // One row, with the two embedded tables `getSessionUser` now asks for in the
    // same request. The separate-query fallback reads the same three shapes.
    users: (state) => {
      // `__breakEmbeds` stands in for a PostgREST schema cache that cannot see
      // the foreign keys, which is the case `getSessionUser`'s fallback exists
      // for. Only the embedded select fails; the three plain reads still work.
      if (globalThis.__RT.fixtures.__breakEmbeds && state.columns.includes('user_security_settings(')) {
        return { data: null, error: { message: 'could not find a relationship (simulated)' } };
      }
      return {
        data: [
          {
            id: USER_ID,
            email: 'agent@example.com',
            full_name: 'Agent',
            is_super_admin: false,
            user_security_settings: null,
            company_users: [
              { company_id: COMPANY_ID, role: 'company_admin', created_at: '2026-01-01T00:00:00.000Z' },
            ],
          },
        ],
      };
    },
    user_security_settings: { data: [{ two_factor_enabled: false, two_factor_verified_at: null }] },
    company_users: { data: [{ company_id: COMPANY_ID, role: 'company_admin' }] },
    conversations: (state) => (state.head ? { data: null, count: conversationRows.length } : { data: conversationRows, count: conversationRows.length }),
    messages: (state) =>
      state.head
        ? { data: null, count: 3 }
        : { data: CONVERSATION_IDS.map((id) => ({ conversation_id: id, sender_type: 'visitor', content_text: 'hello' })) },
    'rpc:inbox_last_messages': {
      data: CONVERSATION_IDS.map((id) => ({ conversation_id: id, sender_type: 'visitor', content_text: 'hello' })),
    },
    'rpc:inbox_queue_counts': {
      data: [{ waiting: 3, mine: 1, everything: 25, urgent: 0, poor: 0, closed: 4 }],
    },
    'rpc:company_dashboard_counts': {
      data: [
        {
          needs_reply: 3,
          open_chats: 6,
          chats_started_current: 10,
          chats_started_previous: 8,
          ai_answered_current: 7,
          ai_answered_previous: 6,
          leads_current: 2,
          leads_previous: 1,
          appointments_current: 1,
          appointments_previous: 0,
          chat_orders_current: 0,
          chat_orders_previous: 0,
          uncontacted_enquiries: 2,
          overdue_replies: 1,
          failed_automations: 0,
          csat_responses: 4,
          csat_average: 4.5,
        },
      ],
    },
    'rpc:company_catalog_counts': {
      data: [{ products: 2, orders: 1, customers: 3, menu_items: 0 }],
    },
    'rpc:company_business_memory': {
      data: {
        profile: { short_description: 'We sell things', primary_phone: '+971500000000' },
        locations: [],
        hours: [],
        policies: [],
        services: [],
        faqs: [],
      },
    },
  };
}

function begin() {
  globalThis.__RT.gen += 1;
  globalThis.__RT.calls = [];
}

function trips() {
  return globalThis.__RT.calls.length;
}

const label = (call) => `${call.kind}:${call.name}`;

function summarise() {
  const byName = new Map();
  for (const call of globalThis.__RT.calls) byName.set(label(call), (byName.get(label(call)) ?? 0) + 1);
  return [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}×${n}`)
    .join(' ');
}

/**
 * Tenant isolation, checked mechanically.
 *
 * Batching queries is exactly the change that can quietly widen a filter, so
 * every table read must carry `company_id = <the session user's company>` and
 * every RPC must be handed the same id.
 *
 * Two things are allowed not to carry it. A read keyed to the SIGNED-IN USER's
 * own id is what decides which company the request belongs to, so it cannot be
 * company-scoped. And `users` is exempt outright, because the inbox also
 * resolves an assigned agent's name from an id that came off an already
 * company-scoped conversation row.
 */
const UNSCOPED_BY_DESIGN = new Set(['users']);

function tenantScopeViolations() {
  const bad = [];
  for (const call of globalThis.__RT.calls) {
    if (call.kind === 'from') {
      if (UNSCOPED_BY_DESIGN.has(call.name)) continue;
      // `companies` is the tenant table itself, so its scope column is `id`.
      const column = call.name === 'companies' ? 'id' : 'company_id';
      const filters = call.state?.filters ?? [];
      const scoped =
        filters.some(([method, field, value]) => method === 'eq' && field === column && value === COMPANY_ID) ||
        filters.some(
          ([method, field, value]) =>
            method === 'eq' && (field === 'user_id' || field === 'id') && value === USER_ID,
        );
      if (!scoped) bad.push(label(call));
    } else if (call.kind === 'rpc') {
      if (call.args?.p_company_id !== COMPANY_ID) bad.push(label(call));
    }
  }
  return bad;
}

async function main() {
  globalThis.__RT = { calls: [], gen: 0, fixtures: {} };
  installFixtures();

  const ns = await loadTs(ENTRIES, stubs);
  const auth = ns['src/lib/auth/index.ts'];
  const i18n = ns['src/lib/i18n/server.ts'];
  const inbox = ns['src/modules/company/inbox-data.ts'];
  const dashboard = ns['src/modules/company/dashboard-data.ts'];
  const setup = ns['src/modules/company/setup-data.ts'];
  const support = ns['src/modules/company/support-settings-data.ts'];
  const companyData = ns['src/modules/company/data.ts'];

  const { check, state } = makeChecker();
  const verbose = process.argv.includes('--verbose');
  const measured = {};

  // --- The session guard every /company page runs before anything else. ------
  begin();
  const user = await auth.getSessionUser();
  measured.session = trips();
  if (verbose) console.log(`   session: ${summarise()}`);
  check(`session guard resolves the company admin`, user?.companyId === COMPANY_ID, user);
  check(
    `session guard costs <= ${BUDGET.session} round trips (measured ${measured.session})`,
    measured.session <= BUDGET.session,
    globalThis.__RT.calls,
  );
  check(
    `getSessionUser is memoised per request`,
    await (async () => {
      const before = trips();
      await auth.getSessionUser();
      await auth.getSessionUser();
      return trips() === before;
    })(),
  );

  // --- Inbox page: exactly what page.tsx awaits. -----------------------------
  begin();
  const [page, counts] = await Promise.all([
    inbox.listConversationsPaged({ page: 1, queue: 'waiting' }),
    inbox.getInboxQueueCounts(),
    companyData.getCompanyId(),
    support.getSupportSettings(),
    i18n.getRequestDictionary(),
    auth.requireRole(['company_admin', 'agent']),
  ]);
  measured.inbox = trips();
  if (verbose) console.log(`   inbox: ${summarise()}`);
  check(`inbox returns a full page of rows`, page.rows.length === 25, page.rows.length);
  check(
    `inbox rows still get a last-message preview`,
    page.rows.every((r) => r.lastMessagePreview === 'hello'),
    page.rows[0],
  );
  check(`inbox queue counts are populated`, counts.everything === 25 && counts.closed === 4, counts);
  check(
    `inbox page costs <= ${BUDGET.inbox} round trips (measured ${measured.inbox})`,
    measured.inbox <= BUDGET.inbox,
    globalThis.__RT.calls,
  );
  check(
    `inbox makes no per-conversation message query`,
    globalThis.__RT.calls.filter((c) => label(c) === 'from:messages').length <= 1,
    globalThis.__RT.calls.filter((c) => label(c) === 'from:messages').length,
  );
  check(`every inbox read is still scoped to the session company`, tenantScopeViolations().length === 0, tenantScopeViolations());

  // --- Home page: dashboard summary + setup progress. ------------------------
  begin();
  const [summary, progress] = await Promise.all([
    dashboard.getCompanyDashboardSummary(),
    setup.getCompanySetupProgress(),
    i18n.getRequestDictionary(),
    auth.requireRole(['company_admin', 'agent']),
  ]);
  measured.dashboard = trips();
  if (verbose) console.log(`   dashboard: ${summarise()}`);
  check(`dashboard summary reports the queue`, summary.needsReply === 3 && summary.openChats === 6, {
    needsReply: summary.needsReply,
    openChats: summary.openChats,
  });
  check(`dashboard week-over-week trend is populated`, summary.conversations7d.current === 10, summary.conversations7d);
  // Six since the website import became the first step. The number is asserted
  // rather than derived so that adding a step is a deliberate edit here too.
  check(`setup progress still resolves`, progress.total === 6, progress.total);
  check(
    `dashboard page costs <= ${BUDGET.dashboard} round trips (measured ${measured.dashboard})`,
    measured.dashboard <= BUDGET.dashboard,
    globalThis.__RT.calls,
  );
  check(
    `dashboard reads the company row once, not once per reader`,
    globalThis.__RT.calls.filter((c) => label(c) === 'from:companies').length <= 1,
    globalThis.__RT.calls.filter((c) => label(c) === 'from:companies').length,
  );
  check(`every dashboard read is still scoped to the session company`, tenantScopeViolations().length === 0, tenantScopeViolations());

  // --- The same pages on a database that has NOT run migration 0062. --------
  // Every batched read has a fallback, and "slower" is the only acceptable
  // failure mode: the page must still be correct.
  const rpcFixtures = Object.keys(globalThis.__RT.fixtures).filter((k) => k.startsWith('rpc:'));
  const saved = Object.fromEntries(rpcFixtures.map((k) => [k, globalThis.__RT.fixtures[k]]));
  for (const key of rpcFixtures) delete globalThis.__RT.fixtures[key];
  globalThis.__RT.fixtures.__breakEmbeds = true;

  begin();
  const [legacyPage, legacyCounts, legacyUser] = await Promise.all([
    inbox.listConversationsPaged({ page: 1, queue: 'waiting' }),
    inbox.getInboxQueueCounts(),
    auth.getSessionUser(),
  ]);
  measured.inboxWithoutRpcs = trips();
  if (verbose) console.log(`   inbox (no 0062): ${summarise()}`);
  check(`without 0062 the session still resolves`, legacyUser?.companyId === COMPANY_ID, legacyUser);
  check(`without 0062 the inbox still renders previews`, legacyPage.rows.every((r) => r.lastMessagePreview === 'hello'));
  check(`without 0062 the queue counts still add up`, legacyCounts.everything === 25, legacyCounts);
  check(`without 0062 tenant scope still holds`, tenantScopeViolations().length === 0, tenantScopeViolations());

  begin();
  const legacySummary = await dashboard.getCompanyDashboardSummary();
  measured.dashboardWithoutRpcs = trips();
  if (verbose) console.log(`   dashboard (no 0062): ${summarise()}`);
  check(`without 0062 the dashboard still counts`, legacySummary.openChats === 25, legacySummary.openChats);
  check(`without 0062 tenant scope still holds on the dashboard`, tenantScopeViolations().length === 0, tenantScopeViolations());

  for (const [key, value] of Object.entries(saved)) globalThis.__RT.fixtures[key] = value;
  delete globalThis.__RT.fixtures.__breakEmbeds;

  console.log('');
  console.log('Round trips measured:');
  for (const [name, value] of Object.entries(measured)) {
    const budget = BUDGET[name];
    console.log(
      `  ${name.padEnd(22)} ${String(value).padStart(3)}${budget === undefined ? '  (fallback path, not budgeted)' : `  (budget ${budget})`}`,
    );
  }
  console.log('');
  console.log(`${state.passed} passed, ${state.failed} failed`);
  if (state.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
