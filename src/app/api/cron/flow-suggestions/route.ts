import { createSupabaseServiceClient } from '@/lib/db/server';
import { generateFlowSuggestions } from '@/lib/flows/suggest';
import { hasFeature } from '@/lib/entitlements';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Companies looked at per run. Weekly, so this comfortably covers the base. */
const MAX_PER_RUN = 100;
/** Do not analyse the same company twice in a week. */
const MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Weekly sweep for suggested guided chats.
 *
 * THIS IS NOT SCHEDULED BY BEING HERE. The production server runs crontab, not
 * Vercel cron — an entry in `vercel.json` alone has silently scheduled nothing
 * twice already. The crontab line that actually runs this is in the handover
 * notes alongside the other cron entries.
 *
 * Three filters keep the bill sane, in the order that costs least:
 *   1. only companies with conversations in the window — a dormant account
 *      produces "not enough data" every week for real money;
 *   2. only companies whose plan includes guided chats, because a suggestion
 *      they cannot build is an advert, not a feature;
 *   3. not more often than every six days per company.
 * `generateFlowSuggestions` then applies its own caps: too little traffic is
 * skipped outright, and at most three drafts are asked of the model.
 *
 * Protect with CRON_SECRET, same as every other route under /api/cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: activity, error } = await sb
    .from('conversations')
    .select('company_id')
    .gte('started_at', since)
    .limit(20000);
  if (error) {
    logger.error('Flow suggestion sweep could not list activity', { error: error.message });
    return json({ error: 'query_failed' }, 500);
  }

  const companies = [
    ...new Set(((activity ?? []) as Array<{ company_id: string }>).map((r) => r.company_id)),
  ].slice(0, MAX_PER_RUN);

  const counts: Record<string, number> = {
    ok: 0,
    skipped: 0,
    failed: 0,
    recent: 0,
    not_entitled: 0,
  };
  let created = 0;

  for (const companyId of companies) {
    try {
      if (!(await hasFeature(companyId, 'flows'))) {
        counts.not_entitled = (counts.not_entitled ?? 0) + 1;
        continue;
      }

      const { data: last } = await sb
        .from('flow_suggestion_runs')
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

      const result = await generateFlowSuggestions(companyId, 30);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      created += result.created;
    } catch (err) {
      counts.failed = (counts.failed ?? 0) + 1;
      logger.error('Flow suggestion sweep threw', {
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({ ok: true, considered: companies.length, created, ...counts });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
