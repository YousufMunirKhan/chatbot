import { createSupabaseServiceClient } from '@/lib/db/server';
import { maybeAutoTopUp } from '@/lib/billing/auto-topup';
import { replenishMonthlyCredit } from '@/lib/billing/credits';
import { sendUsageAlerts } from '@/lib/billing/usage-alerts';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The sweep below is paced by its own budget; this is the ceiling it fits inside. */
export const maxDuration = 60;

/** Never sweep an unbounded number of accounts in one request. */
const MAX_PER_RUN = 200;

/**
 * Companies fetched per query by the replenish + alert sweep.
 *
 * This is a PAGE size, not a run cap. It used to be both, which is what limited
 * a run to the first 500 companies; `sweepCompanies` now walks page after page
 * until it runs out of companies or out of time.
 */
const COMPANIES_PER_PAGE = 500;

/**
 * Runaway guard on the page walk. The cursor advances strictly (see
 * `sweepCompanies`), so this cannot be reached by normal paging — 200 pages is
 * 100,000 companies, ten times the size this endpoint was reasoned about at. It
 * exists so a future bug that stops the cursor advancing burns one run rather
 * than looping until the process is killed.
 */
const MAX_PAGES_PER_RUN = 200;

/**
 * Companies in flight at once. Each one is a handful of small indexed queries,
 * so the limit that matters is Postgres connections, not CPU.
 */
const SWEEP_CONCURRENCY = 8;

/**
 * Stop starting new work after this long and hand back a cursor. Leaves room
 * inside `maxDuration` for the chunk already running to finish and for the
 * response to be written.
 */
const TIME_BUDGET_MS = 45_000;

/** Statuses whose assistant is meant to be answering right now. */
const SWEEPABLE_STATUSES = ['active', 'trialing'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The billing sweep: automatic top-up, monthly included credit, early warning.
 *
 * `maybeAutoTopUp` was built with every guard it needs — a balance threshold, a
 * database-level claim so two callers cannot charge twice, and a cutoff after
 * three consecutive declines — but nothing ever called it on a schedule, so the
 * feature was a manual button wearing the word "automatic". This is the caller.
 *
 * It now also runs the two things that keep a paid plan working past its first
 * month, in this order and for a reason:
 *
 *  1. `replenishMonthlyCredit` puts the plan's included credit back in the
 *     wallet. Included credit used to be granted exactly once, at provisioning,
 *     while every reply deducts from it — so the credit gate in
 *     `src/app/api/chat/route.ts` closed for good as soon as the opening
 *     balance ran out and the assistant went mute regardless of the reply
 *     allowance the customer was paying for. It is idempotent per month (the
 *     ledger row is the lock), which is what makes it safe to call every 15
 *     minutes from here.
 *  2. `sendUsageAlerts` warns the customer before a meter lands. Replenishing
 *     FIRST matters: a company topped up thirty seconds ago must not be emailed
 *     about a balance it no longer has.
 *
 * Each company is evaluated independently: one declined card, one missing
 * wallet or one mail failure must not stop the sweep for everybody else.
 *
 * HOW THIS BEHAVES AT TEN THOUSAND COMPANIES — VERIFIED, NOT ASSUMED
 * ------------------------------------------------------------------
 * One run walks the whole company list in company-id order, a page of
 * `COMPANIES_PER_PAGE` at a time, and stops only when the list is exhausted or
 * `TIME_BUDGET_MS` is spent. If it stopped early it returns `nextCursor` — the
 * last id it finished — in the body and on an `X-Next-Cursor` header, and the
 * caller is expected to come straight back with `?after=<that>`.
 *
 * That second half is the part that was missing, and it is the reason this run
 * cap was worth fixing before it mattered: the endpoint has always returned a
 * cursor, but NOTHING passed it back. Both the crontab entry and the one
 * `scripts/deploy.sh` prints called this bare, so every run restarted at the
 * first id and company 501 onward was never replenished and never warned —
 * silently, and only once the business had grown enough to have a company 501.
 *
 * Two changes close it, and neither alone is enough:
 *   - This route pages internally instead of quitting after one page, so a
 *     single bare call now sweeps everyone it can reach in 45 seconds rather
 *     than the first 500. That is the whole company list at today's scale and
 *     for a long way past it, and it is what protects an operator who never
 *     updates their crontab.
 *   - `scripts/deploy.sh` installs (or prints) a crontab entry that WALKS the
 *     cursor: it re-calls `?after=<X-Next-Cursor>` until the header comes back
 *     empty, under `flock` so two walks cannot overlap. That is what covers ten
 *     thousand, because 45 seconds does not: each company is roughly eight small
 *     indexed queries, so at `SWEEP_CONCURRENCY` in flight a run gets through
 *     thousands, not tens of thousands. Ten thousand companies is two or three
 *     chained calls, and the walker makes that one crontab line instead of a
 *     standing assumption that somebody remembers to chain by hand.
 * The scheduling change has to go in that script. This server does not read
 * `vercel.json` — its crons are real crontab entries on the box — and a previous
 * change to this project was dead for weeks because it was only added there.
 *
 * Three things were checked rather than assumed:
 *   - The cursor is sound. `subscriptions.company_id` is UNIQUE (migration
 *     0004), so ordering by it is total, no company is swept twice in a run,
 *     and `.gt(company_id, cursor)` cannot skip one. Each page starts after the
 *     last id of the previous one, so the walk advances strictly and cannot
 *     stall on a repeated page.
 *   - The run cannot overrun. The deadline is checked before each page and
 *     before each chunk of `SWEEP_CONCURRENCY`, leaving 15s of `maxDuration`
 *     for the chunk in flight and the response.
 *   - An interrupted run loses no money and sends no duplicate. Nothing
 *     persists the cursor, so a walk killed half way (deploy, restart, a 5xx
 *     that stops the walker) simply starts again from the first company on the
 *     next tick and re-does the prefix it had already done. That is safe, not
 *     merely tolerable: `replenishMonthlyCredit` is idempotent per UTC month —
 *     the `included_credit` ledger row under the partial unique index from
 *     migration 0089 is the lock — and `sendUsageAlerts` dedupes off the
 *     notification row it writes. Redoing a prefix costs queries, not a second
 *     top-up and not a second email. The cost is that the tail waits for the
 *     next run, which is why `truncated` is logged as a warning.
 * Remembering progress properly — a `billing_swept_at` column on `subscriptions`,
 * oldest first — would remove even that, but it is a migration and belongs with
 * the billing schema rather than in a route file.
 *
 * WHY A FAILED HALF IS A 5xx
 * --------------------------
 * The two halves are independent on purpose: a broken auto top-up query must
 * not cost every company its replenishment. That is kept. What is not kept is
 * answering 200 while saying so only in the body. `sweepAutoTopUp` used to
 * return a 500 and briefly reported `{ok:true, autoTopUp:{error:'query_failed'}}`
 * instead, which every uptime check and cron alert reads as healthy — and a
 * sweep that has listed zero companies every run for a week looks exactly like
 * a quiet one. So the body still reports what each half achieved, and the
 * STATUS says whether anything failed.
 *
 * Protect with CRON_SECRET and call every 10-15 minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  // Only ever a paging cursor. It bounds WHICH companies this run reaches and
  // is never used as a tenant filter, so the house rule about not taking a
  // company id from a request still holds: nothing here reads or writes data
  // chosen by the caller. Anything that is not a uuid is ignored rather than
  // handed to the query.
  const after = new URL(req.url).searchParams.get('after');
  const cursor = after && UUID.test(after) ? after : null;

  // Each half is also caught HERE, not just inside itself. The inner handlers
  // only catch the failures they anticipated; a service client that cannot be
  // constructed at all threw straight out of the route, which lost the other
  // half's work and returned a framework error page with no body for the
  // scheduler to read.
  const autoTopUp = await runHalf('autoTopUp', () => sweepAutoTopUp(), EMPTY_AUTO_TOPUP);
  const companies = await runHalf('companies', () => sweepCompanies(cursor), EMPTY_COMPANY_SWEEP);

  if (companies.truncated) {
    // Not a failure — the run did what it was asked, and it now walks pages
    // rather than stopping after the first. But whatever is behind this cursor
    // is swept only if the caller comes back for it, and a caller that does not
    // is invisible from a 200 with a healthy-looking body. `chained` is the tell:
    // repeated truncated runs with `chained:false` mean the crontab entry is the
    // old bare curl and the tail of the company list is going unswept.
    logger.warn('Billing sweep did not reach the end of the company list', {
      evaluated: companies.evaluated,
      nextCursor: companies.nextCursor,
      chained: cursor !== null,
      hint: 'Re-call /api/cron/billing?after=<nextCursor> until it comes back empty. The crontab entry in scripts/deploy.sh does this.',
    });
  }

  // Named so an alert can say WHICH half broke without parsing the whole body.
  const failed = [
    autoTopUp.error ? `autoTopUp:${autoTopUp.error}` : null,
    companies.error ? `companies:${companies.error}` : null,
  ].filter((x): x is string => x !== null);

  return json(
    {
      ok: failed.length === 0,
      failed,
      truncated: companies.truncated,
      evaluated: autoTopUp.evaluated,
      autoTopUp,
      companies,
    },
    // 500, not 200-with-an-error-field: a half that could not run is a server
    // fault, and the uptime check watching this endpoint only sees the status.
    // The body is unchanged either way, so whatever the working half achieved
    // is still reported.
    failed.length === 0 ? 200 : 500,
    // The cursor is on a header as well as in the body so the crontab walker can
    // chain runs without a JSON parser. A shell loop that has to `grep` a body
    // for `"nextCursor":"…"` is a quoting accident waiting to happen inside a
    // crontab line; one header and `cut` is not. Absent, not empty, when there
    // is nothing left — so the walker's test is simply "did I get a value".
    companies.nextCursor ? { 'X-Next-Cursor': companies.nextCursor } : undefined,
  );
}

/**
 * Run one half of the sweep and turn any unexpected throw into that half's
 * `error`, so the other half still runs and the caller still gets a body.
 */
async function runHalf<T extends { error?: string }>(
  name: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logger.error('Billing sweep half threw', {
      half: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...fallback, error: 'threw' };
  }
}

interface AutoTopUpSweep {
  evaluated: number;
  counts: Record<string, number>;
  /** Set only when this half could not do its job. Non-empty means a 5xx. */
  error?: string;
}

const EMPTY_AUTO_TOPUP: AutoTopUpSweep = { evaluated: 0, counts: {} };

async function sweepAutoTopUp(): Promise<AutoTopUpSweep> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('company_auto_topup')
    .select('company_id')
    .eq('is_enabled', true)
    .is('disabled_reason', null)
    .limit(MAX_PER_RUN);

  if (error) {
    logger.error('Auto top-up sweep could not list companies', { error: error.message });
    return { ...EMPTY_AUTO_TOPUP, error: 'query_failed' };
  }

  const companies = ((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id);
  const counts: Record<string, number> = {};

  for (const companyId of companies) {
    try {
      const result = await maybeAutoTopUp(companyId);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (result.status === 'failed') {
        logger.warn('Auto top-up failed', { companyId, reason: result.reason });
      }
    } catch (err) {
      counts.error = (counts.error ?? 0) + 1;
      logger.error('Auto top-up threw', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // A declined card is `status:'failed'` and is normal — that company is simply
  // not being charged today. Every attempt THROWING is not normal: it means
  // Stripe or the wallet is down for everyone, which used to be reported as a
  // healthy 200 with the bad news counted in `counts.error`.
  const threw = counts.error ?? 0;
  const systemic = companies.length > 0 && threw === companies.length;
  return {
    evaluated: companies.length,
    counts,
    ...(systemic ? { error: 'all_attempts_threw' } : {}),
  };
}

interface CompanySweep {
  evaluated: number;
  replenished: number;
  alerted: number;
  errors: number;
  /** Last id finished, when the run stopped short of the end. */
  nextCursor: string | null;
  /** True when companies were left unswept — see the header comment. */
  truncated: boolean;
  /** Set only when this half could not do its job. Non-empty means a 5xx. */
  error?: string;
}

const EMPTY_COMPANY_SWEEP: CompanySweep = {
  evaluated: 0,
  replenished: 0,
  alerted: 0,
  errors: 0,
  nextCursor: null,
  truncated: false,
};

async function sweepCompanies(cursor: string | null): Promise<CompanySweep> {
  const sb = createSupabaseServiceClient();
  const sweep: CompanySweep = { ...EMPTY_COMPANY_SWEEP };
  const deadline = Date.now() + TIME_BUDGET_MS;

  // `position` is where the NEXT page starts; `lastFinished` is the last company
  // actually swept. They differ the moment a page is fetched but not finished,
  // and handing back `position` in that case would skip whatever the run did not
  // reach — so the cursor returned to the caller is always `lastFinished`.
  let position = cursor;
  let lastFinished: string | null = null;
  let stoppedEarly = false;
  let moreBehind = false;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }

    // Ordered by company id so the cursor is stable: a company created mid-sweep
    // cannot shuffle the ones still to come out of the way of this run.
    let query = sb
      .from('subscriptions')
      .select('company_id')
      .in('status', SWEEPABLE_STATUSES)
      .order('company_id', { ascending: true })
      .limit(COMPANIES_PER_PAGE);
    if (position) query = query.gt('company_id', position);

    const { data, error } = await query;
    if (error) {
      logger.error('Billing sweep could not list companies', {
        error: error.message,
        page,
        evaluated: sweep.evaluated,
      });
      // Only a run that achieved NOTHING is a failed run. A page that fails
      // after earlier pages swept fine is a truncated one: report what was done,
      // hand back the cursor so the walker resumes at the right place, and let
      // the 200 stand rather than telling the uptime check the whole sweep is
      // down because one query blipped.
      if (sweep.evaluated === 0) return { ...sweep, error: 'query_failed' };
      stoppedEarly = true;
      break;
    }

    // A past-due or cancelled subscription is skipped on purpose: it is not owed
    // fresh credit (`replenishMonthlyCredit` refuses it anyway) and its owner has
    // already been emailed about the payment, so an allowance warning on top
    // would be noise about a service they are not currently receiving.
    const companies = ((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id);

    // A full page means there may be another behind it; a short or empty one is
    // the end of the list. Assigned before the empty-page exit so that a list
    // whose length is an exact multiple of the page size does not report itself
    // truncated on the strength of the previous, full, page.
    moreBehind = companies.length === COMPANIES_PER_PAGE;
    if (companies.length === 0) break;
    position = companies[companies.length - 1] ?? position;

    for (let i = 0; i < companies.length; i += SWEEP_CONCURRENCY) {
      if (Date.now() > deadline) {
        stoppedEarly = true;
        logger.warn('Billing sweep ran out of time', {
          evaluated: sweep.evaluated,
          remainingOnPage: companies.length - i,
        });
        break;
      }
      const chunk = companies.slice(i, i + SWEEP_CONCURRENCY);
      const results = await Promise.all(chunk.map((companyId) => sweepOne(companyId)));
      for (const result of results) {
        sweep.evaluated += 1;
        if (result.replenished) sweep.replenished += 1;
        if (result.alerted) sweep.alerted += 1;
        if (result.failed) sweep.errors += 1;
      }
      lastFinished = chunk[chunk.length - 1] ?? lastFinished;
    }

    if (stoppedEarly || !moreBehind) break;
  }

  // Anything left — a page we know is behind us, or a page we fetched and did
  // not finish — means the caller has to come back. `lastFinished` can still be
  // null if the very first chunk never ran, and a null cursor correctly tells
  // the walker to start again from the beginning rather than skip ahead.
  const morePossible = stoppedEarly || moreBehind;
  sweep.nextCursor = morePossible ? lastFinished : null;
  sweep.truncated = morePossible;

  // One company failing is that company's problem — a missing wallet, a mail
  // bounce — and the count is enough. ALL of them failing is the platform's
  // problem: replenishment and every warning email stopped for everybody, which
  // is precisely the outage this sweep exists to prevent and must not be
  // reported as a healthy run.
  if (sweep.evaluated > 0 && sweep.errors === sweep.evaluated) {
    sweep.error = 'all_companies_failed';
  }
  return sweep;
}

/**
 * One company, top to bottom. Never throws: the two halves are caught
 * separately so that a wallet problem does not cost this company its warning
 * email, and neither one can abort the chunk its siblings are in.
 */
async function sweepOne(
  companyId: string,
): Promise<{ replenished: boolean; alerted: boolean; failed: boolean }> {
  let replenished = false;
  let alerted = false;
  let failed = false;

  try {
    const result = await replenishMonthlyCredit(companyId);
    replenished = result.topped;
  } catch (err) {
    failed = true;
    logger.error('Monthly credit replenishment threw', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await sendUsageAlerts(companyId);
    alerted = result.sent.length > 0;
  } catch (err) {
    failed = true;
    logger.error('Usage alert sweep threw', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { replenished, alerted, failed };
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
