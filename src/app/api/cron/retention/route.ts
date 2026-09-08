import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retention purge job. Deletes conversations past each company's configured
 * retention window via the cleanup_old_chats() DB function (migration 0012).
 * Protect with CRON_SECRET and call on a schedule (e.g. Vercel Cron / GH Action):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://app/api/cron/retention
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(JSON.stringify({ error: 'cron_not_configured' }), { status: 503 });
  const auth = req.headers.get('authorization') || '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim() || new URL(req.url).searchParams.get('secret') || '';
  if (provided !== secret) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc('cleanup_old_chats');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // Conversations were the only thing this ever deleted. Three helpdesk log
  // tables have been appended to since the day they were created and never once
  // pruned — and a health check writes on a timer, so their size tracks uptime
  // rather than usage. Failing to prune them must not fail the whole sweep, so
  // the result is reported rather than thrown.
  const { data: helpdesk, error: helpdeskError } = await sb.rpc('cleanup_helpdesk_logs', {
    p_max_rows: 20000,
  });
  if (helpdeskError) {
    logger.error('Helpdesk log retention failed', {
      module: 'cron/retention',
      error: helpdeskError.message,
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    conversationsDeleted: data ?? 0,
    helpdeskLogs: helpdeskError ? { error: helpdeskError.message } : (helpdesk ?? null),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
