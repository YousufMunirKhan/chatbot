import { createSupabaseServiceClient } from '@/lib/db/server';
import { runSync } from '@/lib/integrations/sync';
import { serverEnv } from '@/lib/env';
import { processDueJobs } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { sendImprovementEmail } from '@/modules/super-admin/improvements-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled work that has no route of its own: the hourly integration sync, the
 * `background_jobs` queue, the weekly improvement digest, and chat retention.
 *
 * This existed as POST-only, authenticated with `SUPABASE_SERVICE_ROLE_KEY`, and
 * nothing anywhere called it. It was absent from `vercel.json` and from the
 * server's crontab, and Vercel Cron only issues GET, so it could not have been
 * scheduled as written. All four jobs were dead: shops never refreshed despite
 * the connect page promising an hourly refresh, queued background jobs were
 * never drained, the digest never went out, and old chats were never purged.
 *
 * GET now mirrors the seven sibling routes — `?task=` plus a `CRON_SECRET`
 * bearer — so one scheduler configuration covers all of them. Using the service
 * role key as a cron credential was wrong twice over: it is the key that
 * bypasses row-level security, and scheduling it means writing it into a
 * crontab line that every process on the box can read.
 *
 * POST is kept, unchanged, for anything already wired to it.
 */

type Task = 'sync' | 'cleanup' | 'jobs' | 'improvement_emails';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const task = (new URL(req.url).searchParams.get('task') ?? 'sync') as Task;
  try {
    return json(await runTask(task));
  } catch (err) {
    logger.error('Scheduled task failed', {
      task,
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: 'task_failed', task }, 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const e = serverEnv();
  if (!e.SUPABASE_SERVICE_ROLE_KEY || auth !== `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const { task } = (await req.json().catch(() => ({}))) as { task?: Task };
  return json(await runTask(task ?? 'sync'));
}

async function runTask(task: Task): Promise<Record<string, unknown>> {
  const sb = createSupabaseServiceClient();

  if (task === 'cleanup') {
    const { data } = await sb.rpc('cleanup_old_chats');
    return { task, deleted: data ?? 0 };
  }

  if (task === 'jobs') {
    return { task, ...(await processDueJobs()) };
  }

  // Weekly "how to improve your assistant" digest to every active company.
  if (task === 'improvement_emails') {
    const { data: companies } = await sb
      .from('companies')
      .select('id')
      .eq('status', 'active')
      .limit(500);
    let sent = 0;
    for (const c of companies ?? []) {
      try {
        const res = await sendImprovementEmail((c as { id: string }).id);
        if (res.sent) sent++;
      } catch {
        /* skip a failing company, keep going */
      }
    }
    return { task, companies: (companies ?? []).length, sent };
  }

  // Default: reconciliation sync for integrations that are due a refresh.
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from('integration_accounts')
    .select('id')
    .eq('status', 'connected')
    .or(`next_sync_at.is.null,next_sync_at.lte.${nowIso}`)
    .limit(50);

  let totalRecords = 0;
  let truncatedShops = 0;
  for (const acc of due ?? []) {
    const outcome = await runSync((acc as { id: string }).id);
    totalRecords += outcome.records;
    if (outcome.truncated) truncatedShops++;
  }
  return {
    task: 'sync',
    integrations: (due ?? []).length,
    records: totalRecords,
    // A shop too large for one run is picked up again on the next pass; saying
    // so here means the number is visible to whoever is watching the scheduler.
    truncatedShops,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
