import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One pass, so a backlog drains over several runs instead of one long request. */
const SWEEP_LIMIT = 500;

/**
 * Snooze sweep. Clears the snooze on conversations whose chosen time has passed.
 *
 * This job is a tidy-up, not the mechanism. The inbox queues test
 * `snoozed_until` against the current time themselves, so a conversation
 * reappears the moment it is due whether or not this has run — which matters,
 * because a cron job that quietly stops is a normal Tuesday and a customer who
 * is never answered is not. What the sweep adds is that the row stops carrying
 * a stale "put aside by Sam until Tuesday" once Tuesday has been and gone, so
 * the panel does not describe a snooze that is no longer in force.
 *
 * Deliberately cross-tenant, like the SLA sweep next door: it asks one question
 * of every company at once, runs on the service-role client, and is reachable
 * only with CRON_SECRET. It reads and writes nothing that is scoped to a
 * caller, so there is no session company to scope it to.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/snooze
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();

  try {
    // Two round trips rather than one blind `update ... where snoozed_until <=
    // now()`: the ids are wanted for the log line, and the bounded id list keeps
    // one very large backlog from turning into one very long write.
    const { data: due, error: readError } = await sb
      .from('conversations')
      .select('id')
      .not('snoozed_until', 'is', null)
      .lte('snoozed_until', now)
      .limit(SWEEP_LIMIT);
    if (readError) throw readError;

    const ids = ((due ?? []) as Array<Record<string, unknown>>).map((row) => row.id as string);
    if (ids.length === 0) return json({ ok: true, woken: 0 });

    const { error: writeError } = await sb
      .from('conversations')
      .update({ snoozed_until: null, snoozed_by: null })
      .in('id', ids);
    if (writeError) throw writeError;

    logger.info('Snooze sweep woke conversations', { woken: ids.length });
    return json({ ok: true, woken: ids.length, more: ids.length === SWEEP_LIMIT });
  } catch (err) {
    logger.error('Snooze sweep failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'sweep_failed' }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
