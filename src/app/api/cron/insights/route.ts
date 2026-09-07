import { createSupabaseServiceClient } from '@/lib/db/server';
import { generateInsights } from '@/lib/ai/insights';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Companies analysed per run. Weekly, so this comfortably covers the base. */
const MAX_PER_RUN = 100;
/** Do not re-analyse a company more often than this. */
const MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Weekly insights sweep.
 *
 * Only companies with recent conversation activity are analysed — running the
 * model over a dormant account costs money and produces "not enough data" every
 * week. Protect with CRON_SECRET; schedule weekly (see vercel.json).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Companies that actually had conversations in the window.
  const { data: activity, error } = await sb
    .from('conversations')
    .select('company_id')
    .gte('started_at', since)
    .limit(20000);
  if (error) {
    logger.error('Insights sweep could not list activity', { error: error.message });
    return json({ error: 'query_failed' }, 500);
  }

  const companies = [
    ...new Set(((activity ?? []) as Array<{ company_id: string }>).map((r) => r.company_id)),
  ].slice(0, MAX_PER_RUN);

  const counts: Record<string, number> = { ok: 0, skipped: 0, failed: 0, recent: 0 };

  for (const companyId of companies) {
    try {
      const { data: last } = await sb
        .from('ai_insight_runs')
        .select('created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastAt = (last as { created_at?: string } | null)?.created_at;
      if (lastAt && Date.now() - new Date(lastAt).getTime() < MIN_INTERVAL_MS) {
        counts.recent = (counts.recent ?? 0) + 1;
        continue;
      }

      const result = await generateInsights(companyId, 30);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
    } catch (err) {
      counts.failed = (counts.failed ?? 0) + 1;
      logger.error('Insights sweep threw', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({ ok: true, considered: companies.length, ...counts });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
