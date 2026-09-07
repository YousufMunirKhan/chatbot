import { createSupabaseServiceClient } from '@/lib/db/server';
import { humanizeToken, labelFor } from '@/lib/constants';
import { formatDate, formatNumber } from '@/lib/format';
import { getCompanyId, getCurrentCompany } from '@/modules/company/data';

/**
 * The company's own activity log — the read side of `audit_logs` (migration 0002).
 *
 * WHY THIS EXISTS
 * ---------------
 * Company actions have been writing to `audit_logs` since the beginning, and
 * only `/super-admin/audit-logs` ever read it. So the one question the rows
 * were written to answer — "who deleted that flow", "who removed Sara from the
 * team", "who moved us onto the bigger plan" — could be answered by the
 * platform operator and by nobody else, least of all the business whose staff
 * did it. This module gives those rows back to the people they are about.
 *
 * TENANCY, AND THE NULL COMPANY
 * -----------------------------
 * The service-role client bypasses row-level security, so `.eq('company_id', …)`
 * against the SESSION's company id — never a value out of the request — IS the
 * tenant boundary here. `audit_logs.company_id` is `on delete set null`, so a
 * deleted tenant leaves its rows behind with a null company; `eq` against a
 * non-null uuid never matches null in SQL, so those rows cannot surface on
 * anyone's page. The same filter also excludes the platform's own settings
 * entries (`platform.*`), which are written with no company at all.
 *
 * READABILITY
 * -----------
 * `action` is a machine token (`company.onboarded`), and a shop owner reading
 * `helpdesk.connector_doc_approved` learns nothing. Every token is mapped to a
 * predicate below and rendered as "<who> <did what>", through the same
 * `labelFor`/`humanizeToken` pair the rest of the dashboard uses — so a token
 * added by a future action is still readable here on the day it first fires,
 * without this file having been touched.
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * Action token → the predicate of a sentence whose subject is the actor.
 *
 * Written to complete "Sara Ahmed ___", present-tense object included, because
 * a bare noun label ("Agent removed") hides the two facts that matter: that a
 * person did it, and what they did it to.
 *
 * `company.deleted` is deliberately absent. It is written with a null company
 * (the row it would point at is gone), so it can never be selected here.
 * `platform.*` is absent for the same reason.
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  // The account itself. Most of these are the platform operator's doing, which
  // is exactly why a customer should be able to see them.
  'company.self_serve_signup': 'created this account',
  'company.onboarded': 'set this account up',
  'company.activated': 'put this account back to active',
  'company.suspended': 'suspended this account',
  'subscription.updated': 'changed the plan',
  'credit.top_up': 'added credit to the account',
  'replies.granted': 'granted extra replies',
  'improvements.emailed': 'emailed the "how to improve" report',
  'eval.graded_run': 'ran a scored test of the assistant',
  'super_admin.impersonation_started': 'signed in to this account to help',
  // The team
  'agent.invited': 'invited a teammate',
  'agent.invite_accepted': 'accepted an invitation and joined the team',
  'agent.removed': 'removed a teammate',
  // The inbox
  'conversation.assigned': 'assigned a conversation',
  'conversation.unassigned': 'took a conversation off whoever had it',
  'conversation.snoozed': 'snoozed a conversation',
  'conversation.woken': 'brought a snoozed conversation back',
  // The staff help desk
  'helpdesk.stock_update': 'changed a product’s stock count',
  'helpdesk.connector_doc_edited': 'edited a help-desk document',
  'helpdesk.connector_doc_approved': 'approved a help-desk document',
};

/**
 * Metadata keys worth showing, and what to call them.
 *
 * `metadata_json` is a free-form blob written by a dozen different actions and
 * holds internal ids, nested objects and diagnostics alongside the two or three
 * facts a person actually wants. Anything not named here is dropped rather than
 * printed as machine text — `humanizeToken` cannot rescue a camelCase key
 * (`adminEmail` would render as "Adminemail"), and a page whose point is
 * readability must not end in a wall of raw JSON. The complete row is still
 * there for the operator's own audit screen.
 */
const AUDIT_DETAIL_LABELS: Record<string, string> = {
  plan: 'Plan',
  status: 'Status',
  companyStatus: 'Account',
  subscriptionStatus: 'Subscription',
  adminEmail: 'Owner',
  email: 'Email',
  freeUntil: 'Free until',
  signupSource: 'Signed up via',
  messageLimit: 'Message limit',
  agentLimit: 'Team limit',
  botLimit: 'Assistant limit',
  integrationLimit: 'Connected app limit',
  monthlyAiBudgetUsd: 'Monthly AI budget',
  amountGbp: 'Amount added',
  startingCreditGbp: 'Starting credit',
  setupFeeGbp: 'Setup fee',
  description: 'Note',
  reason: 'Reason',
  replyCount: 'Extra replies',
  grantType: 'Kind of grant',
  expiresAt: 'Expires',
  durationMinutes: 'For how long (minutes)',
  emailSent: 'Invitation emailed',
  sent: 'Report emailed',
  until: 'Snoozed until',
  productTitle: 'Product',
  previousQuantity: 'Stock before',
  nextQuantity: 'Stock after',
  module: 'Area',
  screen: 'Screen',
  previousStatus: 'Was',
};

/** Values that are ISO timestamps, so they read as dates rather than as strings. */
const DATE_DETAIL_KEYS = new Set(['freeUntil', 'expiresAt', 'until']);

/** Values that are money, in pounds. */
const GBP_DETAIL_KEYS = new Set(['amountGbp', 'startingCreditGbp', 'setupFeeGbp']);

/**
 * `formatCurrency` rounds to whole units, which is right for a plan price and
 * wrong for a ledger line: a £12.50 top-up must not be recorded here as £13.
 */
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** Sentence case, so a predicate can double as a filter option. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The name of an action, for a dropdown or a badge: "Changed the plan". */
export function auditActionLabel(action: string): string {
  return capitalise(labelFor(AUDIT_ACTION_LABELS, action));
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One named fact off `metadata_json`, already formatted for reading. */
export interface ActivityDetail {
  label: string;
  value: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  /** "Changed the plan" — the action on its own, for the filter and the badge. */
  actionLabel: string;
  /** "Sara Ahmed changed the plan" — the whole thing, in one line. */
  sentence: string;
  /** Done by the platform's own staff rather than by anyone at this company. */
  byOperator: boolean;
  createdAt: string;
  details: ActivityDetail[];
  /** Where the thing that was acted on lives, when it is somewhere reachable. */
  link: { href: string; label: string } | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** One option in the "who" dropdown. */
export interface ActivityActorOption {
  /** The `actor` search-param value: a user id, or the literal `operator`. */
  value: string;
  label: string;
}

/** One option in the "what happened" dropdown. */
export interface ActivityActionOption {
  value: string;
  label: string;
}

export interface ActivityFilters {
  /** A user id, or `operator` for "anyone from the support team". */
  actor?: string;
  /** An `audit_logs.action` token. */
  type?: string;
  /** `YYYY-MM-DD`, inclusive, read in the company's own timezone. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive, read in the company's own timezone. */
  to?: string;
  page?: number;
}

export interface ActivityView {
  results: ActivityPage;
  actors: ActivityActorOption[];
  actions: ActivityActionOption[];
  /** Which timezone the two date boxes are counted in, for the hint under them. */
  timezone: string;
}

/** The `actor` value meaning "the platform's staff, whoever it was". */
export const OPERATOR_ACTOR = 'operator';

const PAGE_SIZE = 25;

/**
 * How far back the two dropdowns look for the options they offer.
 *
 * PostgREST cannot express `select distinct`, and this table only ever grows,
 * so the filter options come from a bounded window of the most recent entries —
 * two narrow columns, one round trip. It is the recent history that anyone
 * filters, and an actor who has not appeared in 2,000 entries is not one a
 * person is scrolling a dropdown to find. The window bounds the OPTIONS only:
 * a filter, once chosen, is applied to the whole table.
 */
const FACET_SCAN_LIMIT = 2000;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How far `timeZone` is from UTC at a given instant, in milliseconds.
 *
 * Read AT the instant rather than taken from a table, because the answer moves
 * twice a year. An unknown or malformed timezone (the column is free text) is
 * treated as UTC rather than throwing a whole page away.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    // Some ICU builds render midnight as hour 24 under `hour12: false`.
    const hour = get('hour') % 24;
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return asIfUtc - utcMs;
  } catch {
    return 0;
  }
}

/**
 * The instant a calendar day begins in `timeZone`, as an ISO string.
 *
 * `dayOffset` shifts by whole days, so the "to" box can ask for the start of
 * the following day and stay inclusive of everything typed on the day chosen.
 *
 * Two passes: the offset has to be sampled somewhere, and sampling it at
 * midnight UTC puts the sample on the wrong side of a clock change for anyone
 * far enough east or west. The second pass samples at the corrected instant.
 */
function zonedDayStartIso(day: string, timeZone: string, dayOffset = 0): string | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const [, year, month, date] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(date);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const naive = Date.UTC(y, m - 1, d + dayOffset);
  if (Number.isNaN(naive)) return null;
  const firstPass = naive - zoneOffsetMs(naive, timeZone);
  return new Date(naive - zoneOffsetMs(firstPass, timeZone)).toISOString();
}

/** A `YYYY-MM-DD` string, or undefined if the box held something else. */
function cleanDay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return DAY_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * The query string, cleaned up, before anything is rendered from it.
 *
 * The page needs the same answer the query does — a hand-typed `?actor=bob`
 * that the query would ignore must not leave the filter bar claiming a filter
 * is on and offering a "Clear" button that changes nothing. Normalising once,
 * here, keeps the bar, the "nothing matches that" copy, the pagination links
 * and the query itself all describing the same request.
 */
export function normaliseActivityFilters(raw: {
  actor?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: string;
}): ActivityFilters {
  const actor = raw.actor?.trim();
  const page = Number.parseInt(raw.page ?? '1', 10);
  return {
    actor: actor === OPERATOR_ACTOR || (actor && UUID_PATTERN.test(actor)) ? actor : undefined,
    type: raw.type?.trim() || undefined,
    from: cleanDay(raw.from),
    to: cleanDay(raw.to),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ActorRecord {
  id: string;
  label: string;
  isOperator: boolean;
}

/**
 * Who to say did it.
 *
 * The company's own people are named individually — they work for the reader,
 * and "who did this" is the whole question. The platform's staff are named as
 * "Support team" instead of by their work email: the accountable party from the
 * customer's side is the platform, and an operator's personal address is not
 * part of what the customer is owed. Nothing is hidden — the entry is listed,
 * badged as ours, and says exactly what was done.
 */
function actorName(actor: ActorRecord | null): string {
  if (!actor) return 'Someone';
  if (actor.isOperator) return 'Support team';
  return actor.label;
}

function detailValue(key: string, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'number') {
    if (GBP_DETAIL_KEYS.has(key)) return gbp.format(raw);
    return formatNumber(raw);
  }
  if (typeof raw === 'string') {
    if (DATE_DETAIL_KEYS.has(key)) return formatDate(raw);
    // A long free-text note is still a fact; it is the table cell that has to
    // cope, not this function.
    return raw;
  }
  // Arrays and nested objects are internal shapes, not sentences. Skipped for
  // the same reason unnamed keys are.
  return null;
}

function buildDetails(metadata: Record<string, unknown>): ActivityDetail[] {
  const details: ActivityDetail[] = [];
  for (const [key, label] of Object.entries(AUDIT_DETAIL_LABELS)) {
    if (!(key in metadata)) continue;
    const value = detailValue(key, metadata[key]);
    if (value === null) continue;
    details.push({ label, value });
  }
  return details;
}

/**
 * The one target worth linking to. A conversation is a page the reader can
 * open; every other target id is an internal key, so it is left out rather than
 * printed as a uuid nobody can act on.
 */
function buildLink(targetType: string | null, targetId: string | null): ActivityEntry['link'] {
  if (targetType !== 'conversation' || !targetId || !UUID_PATTERN.test(targetId)) return null;
  return { href: `/company/inbox/${targetId}`, label: 'Open the conversation' };
}

function toEntry(row: Record<string, unknown>, actors: Map<string, ActorRecord>): ActivityEntry {
  const action = row.action as string;
  const actorId = (row.actor_user_id as string | null) ?? null;
  const actor = actorId ? (actors.get(actorId) ?? null) : null;
  const who = actorName(actor);
  const predicate = AUDIT_ACTION_LABELS[action];
  const metadata = (row.metadata_json as Record<string, unknown> | null) ?? {};

  return {
    id: row.id as string,
    action,
    actionLabel: auditActionLabel(action),
    // An action we have not written a sentence for is still shown, joined by a
    // dash rather than forced into grammar it does not fit. Dropping it would
    // make the log quietly incomplete, which is the one thing an audit trail
    // may not be.
    sentence: predicate ? `${who} ${predicate}` : `${who} — ${humanizeToken(action)}`,
    byOperator: Boolean(actor?.isOperator),
    createdAt: row.created_at as string,
    details: buildDetails(metadata),
    link: buildLink((row.target_type as string | null) ?? null, (row.target_id as string | null) ?? null),
  };
}

const emptyPage = (page: number): ActivityPage => ({
  entries: [],
  total: 0,
  page,
  pageSize: PAGE_SIZE,
  pageCount: 1,
});

/**
 * Everything the activity page renders.
 *
 * ROUND TRIPS
 * A round trip to this deployment's Postgres costs ~230 ms whatever it asks
 * for, so the count is what matters. The page of rows and the scan that fills
 * the dropdowns do not depend on each other, so they go together, and one
 * lookup then names every actor either of them found: two waves.
 *
 * The exception is filtering by "Support team", which has to know WHO the
 * operators are before it can ask for their rows — that one view spends a third
 * trip, and only that one.
 */
export async function getCompanyActivity(filters: ActivityFilters = {}): Promise<ActivityView> {
  const companyId = await getCompanyId();
  const company = await getCurrentCompany();
  const timezone = company.timezone?.trim() || 'UTC';
  const sb = createSupabaseServiceClient();

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const from = cleanDay(filters.from);
  const to = cleanDay(filters.to);
  const type = filters.type?.trim() || undefined;
  const actorFilter = filters.actor?.trim() || undefined;
  const byOperator = actorFilter === OPERATOR_ACTOR;

  const facetQuery = sb
    .from('audit_logs')
    .select('action,actor_user_id')
    .eq('company_id', companyId) // the tenant boundary; also drops null-company rows
    .order('created_at', { ascending: false })
    .limit(FACET_SCAN_LIMIT);

  const pageQuery = (operatorIds: string[]) => {
    let query = sb
      .from('audit_logs')
      .select('id,action,actor_user_id,target_type,target_id,metadata_json,created_at', {
        count: 'exact',
      })
      .eq('company_id', companyId); // the tenant boundary, again — every read carries it

    if (byOperator) query = query.in('actor_user_id', operatorIds);
    else if (actorFilter && UUID_PATTERN.test(actorFilter)) {
      query = query.eq('actor_user_id', actorFilter);
    }

    if (type) query = query.eq('action', type);
    if (from) {
      const iso = zonedDayStartIso(from, timezone);
      if (iso) query = query.gte('created_at', iso);
    }
    if (to) {
      // The start of the NEXT day, so "to 3 March" includes everything done on
      // the 3rd rather than stopping at midnight on the way in.
      const iso = zonedDayStartIso(to, timezone, 1);
      if (iso) query = query.lt('created_at', iso);
    }

    const start = (page - 1) * PAGE_SIZE;
    return query.order('created_at', { ascending: false }).range(start, start + PAGE_SIZE - 1);
  };

  const knownActors = new Map<string, ActorRecord>();
  const facetActorIds = new Set<string>();
  const facetActions = new Set<string>();
  const readFacets = (rows: Array<Record<string, unknown>> | null) => {
    for (const row of rows ?? []) {
      const id = row.actor_user_id as string | null;
      if (id) facetActorIds.add(id);
      const seen = row.action as string | null;
      if (seen) facetActions.add(seen);
    }
  };

  let pageResult: Awaited<ReturnType<typeof pageQuery>> | null = null;

  if (byOperator) {
    const facets = await facetQuery;
    if (facets.error) throw facets.error;
    readFacets(facets.data as Array<Record<string, unknown>> | null);
    for (const [id, actor] of await loadActors(sb, [...facetActorIds])) knownActors.set(id, actor);

    const operatorIds = [...knownActors.values()].filter((a) => a.isOperator).map((a) => a.id);
    // An `in.()` with nothing in it is not a filter PostgREST can send, and
    // "nobody from the support team has touched this account" is a real answer.
    if (operatorIds.length) pageResult = await pageQuery(operatorIds);
  } else {
    const [facets, rows] = await Promise.all([facetQuery, pageQuery([])]);
    if (facets.error) throw facets.error;
    readFacets(facets.data as Array<Record<string, unknown>> | null);
    pageResult = rows;
  }

  if (pageResult?.error) throw pageResult.error;
  const rows = (pageResult?.data ?? []) as unknown as Array<Record<string, unknown>>;

  // One lookup for every actor either query named. The page can reach back past
  // the facet window, so its own rows are included rather than being rendered
  // as "Someone".
  const wanted = new Set(facetActorIds);
  for (const row of rows) {
    const id = row.actor_user_id as string | null;
    if (id) wanted.add(id);
  }
  const missing = [...wanted].filter((id) => !knownActors.has(id));
  if (missing.length) {
    for (const [id, actor] of await loadActors(sb, missing)) knownActors.set(id, actor);
  }

  // The dropdowns only ever offer what this company's log actually contains, so
  // neither of them can hand the reader a choice that returns nothing.
  const actors: ActivityActorOption[] = [...facetActorIds]
    .map((id) => knownActors.get(id))
    .filter((a): a is ActorRecord => a !== undefined && !a.isOperator)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((a) => ({ value: a.id, label: a.label }));
  const hasOperatorEntries = [...facetActorIds].some((id) => knownActors.get(id)?.isOperator);
  if (hasOperatorEntries) actors.push({ value: OPERATOR_ACTOR, label: 'Support team' });

  const actions: ActivityActionOption[] = [...facetActions]
    .map((value) => ({ value, label: auditActionLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!pageResult) return { results: emptyPage(page), actors, actions, timezone };

  const total = pageResult.count ?? 0;
  return {
    results: {
      entries: rows.map((row) => toEntry(row, knownActors)),
      total,
      page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    },
    actors,
    actions,
    timezone,
  };
}

/**
 * How many ids one `in.(…)` may carry.
 *
 * PostgREST takes its filters in the URL, so a long enough list stops being a
 * query and starts being a 414. A company with hundreds of people who have all
 * acted is unusual but not impossible, and losing every name past the first
 * hundred would be a silent wrong answer, so the list is chunked instead.
 */
const ACTOR_LOOKUP_CHUNK = 100;

/**
 * Names for a set of actor ids.
 *
 * Not scoped to this company on purpose, and safe: the ids come only from rows
 * already proven to belong to the caller's company, and the platform's own
 * staff are never members of it. Nothing but a display name and the operator
 * flag is read.
 */
async function loadActors(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  ids: string[],
): Promise<Map<string, ActorRecord>> {
  const actors = new Map<string, ActorRecord>();
  if (!ids.length) return actors;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ACTOR_LOOKUP_CHUNK) {
    chunks.push(ids.slice(i, i + ACTOR_LOOKUP_CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) => sb.from('users').select('id,email,full_name,is_super_admin').in('id', chunk)),
  );

  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = row.id as string;
      const fullName = (row.full_name as string | null)?.trim();
      const email = (row.email as string | null)?.trim();
      actors.set(id, {
        id,
        label: fullName || email || 'Someone',
        isOperator: Boolean(row.is_super_admin),
      });
    }
  }
  return actors;
}
