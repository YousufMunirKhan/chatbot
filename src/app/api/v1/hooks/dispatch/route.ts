import { drainRestHookEvents } from '@/lib/api/hooks';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The REST hook dispatcher. Delivers everything migration 0079's triggers have
 * queued in `rest_hook_events`, through the existing signed webhook path.
 *
 * WHY THIS ONE ROUTE UNDER /api/v1 IS NOT `withApiAuth`
 * -----------------------------------------------------
 * Every other route in this namespace is a customer's own integration calling
 * with its own key, and `withApiAuth` resolves that key to exactly one company.
 * This is the opposite: a scheduled sweep across every tenant at once, with no
 * caller to scope it to. Authenticating it with a tenant's API key would be
 * wrong twice — one company's key would drive delivery for all of them, and the
 * per-key rate limit would throttle the platform's own cron. So it takes the
 * same `CRON_SECRET` bearer as the seven sweeps under `/api/cron`, and it lives
 * here because it is part of the hooks feature and nothing else may call it.
 *
 * GET, because Vercel Cron only issues GET (and sends the bearer itself). POST
 * is accepted too, for running a drain by hand while debugging.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/v1/hooks/dispatch
 *
 * NOT SCHEDULED = NOT DELIVERED. This needs an entry in `vercel.json`:
 *   { "path": "/api/v1/hooks/dispatch", "schedule": "* * * * *" }
 * Without it the triggers keep queueing events that nobody sends. Every-minute
 * matches `/api/cron/sla`; a Zap that arrives a minute later is still an order
 * of magnitude quicker than the polling it replaces.
 */
export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  try {
    const result = await drainRestHookEvents();
    if (result.claimed > 0) {
      logger.info('REST hook dispatch', {
        module: 'api/v1/hooks',
        claimed: result.claimed,
        dispatched: result.dispatched,
        disabledCompanies: result.disabledCompanies,
      });
    }
    return json({ ok: true, ...result });
  } catch (err) {
    logger.error('REST hook dispatch failed', {
      module: 'api/v1/hooks',
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'dispatch_failed' }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
