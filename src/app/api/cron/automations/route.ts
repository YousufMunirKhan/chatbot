import { detectAbandonedCarts } from '@/lib/commerce/abandoned-cart';
import { dispatchDueAutomations } from '@/lib/commerce/automations';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * E-commerce automation cron. Run it every few minutes with
 * `Authorization: Bearer $CRON_SECRET` — the same guard the broadcast
 * dispatcher uses.
 *
 * Order matters: detect abandoned carts first so anything that crossed the
 * threshold since the last run is queued, then dispatch everything that is due.
 * Both halves are idempotent, so an overlapping run is harmless.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 100);

  try {
    const carts = await detectAbandonedCarts();
    const dispatched = await dispatchDueAutomations(Number.isFinite(limit) ? limit : 100);
    return json({ ok: true, carts, dispatched }, 200);
  } catch (err) {
    logger.error('Automation cron failed', { error: err instanceof Error ? err.message : String(err) });
    return json({ ok: false, error: 'cron_failed' }, 500);
  }
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
