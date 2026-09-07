import { createSupabaseServiceClient } from '@/lib/db/server';
import { maybeAutoTopUp } from '@/lib/billing/auto-topup';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never sweep an unbounded number of accounts in one request. */
const MAX_PER_RUN = 200;

/**
 * Automatic credit top-up sweep.
 *
 * `maybeAutoTopUp` was built with every guard it needs — a balance threshold, a
 * database-level claim so two callers cannot charge twice, and a cutoff after
 * three consecutive declines — but nothing ever called it on a schedule, so the
 * feature was a manual button wearing the word "automatic". This is the caller.
 *
 * Each company is evaluated independently: one declined card must not stop the
 * sweep for everybody else.
 *
 * Protect with CRON_SECRET and call every 10–15 minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('company_auto_topup')
    .select('company_id')
    .eq('is_enabled', true)
    .is('disabled_reason', null)
    .limit(MAX_PER_RUN);

  if (error) {
    logger.error('Auto top-up sweep could not list companies', { error: error.message });
    return json({ error: 'query_failed' }, 500);
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

  return json({ ok: true, evaluated: companies.length, ...counts });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
