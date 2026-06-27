import { createSupabaseServiceClient } from '@/lib/db/server';
import { runSync } from '@/lib/integrations/sync';
import { serverEnv } from '@/lib/env';
import { processDueJobs } from '@/lib/jobs';
import { sendImprovementEmail } from '@/modules/super-admin/improvements-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled jobs entry point (Module 14 hourly sync + Module 23 retention).
 * Trigger this hourly from Trigger.dev / Vercel Cron with an Authorization
 * bearer equal to SUPABASE_SERVICE_ROLE_KEY. POST { task: 'sync' | 'cleanup' }.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const e = serverEnv();
  if (!e.SUPABASE_SERVICE_ROLE_KEY || auth !== `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const { task } = (await req.json().catch(() => ({}))) as { task?: string };
  const sb = createSupabaseServiceClient();

  if (task === 'cleanup') {
    const { data } = await sb.rpc('cleanup_old_chats');
    return Response.json({ task, deleted: data ?? 0 });
  }

  if (task === 'jobs') {
    return Response.json({ task, ...(await processDueJobs()) });
  }

  // Weekly "how to improve your assistant" digest to every active company.
  if (task === 'improvement_emails') {
    const { data: companies } = await sb.from('companies').select('id').eq('status', 'active').limit(500);
    let sent = 0;
    for (const c of companies ?? []) {
      try {
        const res = await sendImprovementEmail((c as { id: string }).id);
        if (res.sent) sent++;
      } catch {
        /* skip a failing company, keep going */
      }
    }
    return Response.json({ task, companies: (companies ?? []).length, sent });
  }

  // Default: reconciliation sync for due integrations.
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from('integration_accounts')
    .select('id')
    .eq('status', 'connected')
    .or(`next_sync_at.is.null,next_sync_at.lte.${nowIso}`)
    .limit(50);

  let totalRecords = 0;
  for (const acc of due ?? []) {
    const outcome = await runSync((acc as { id: string }).id);
    totalRecords += outcome.records;
  }
  return Response.json({ task: 'sync', integrations: (due ?? []).length, records: totalRecords });
}
