import { sweepSlaBreaches } from '@/lib/sla';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SLA breach sweep. Flags conversations that passed their first-response or
 * resolution target, warns shortly before a deadline, and escalates where the
 * policy names someone.
 *
 * Deadlines are stored when the clock starts, so this is an index scan over
 * "due before now and not yet met" — cheap enough to run every minute.
 * Protect with CRON_SECRET and call on a schedule.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  try {
    const result = await sweepSlaBreaches();
    return json({ ok: true, ...result });
  } catch (err) {
    logger.error('SLA sweep failed', { error: err instanceof Error ? err.message : String(err) });
    return json({ error: 'sweep_failed' }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
