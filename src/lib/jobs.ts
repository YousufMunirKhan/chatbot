import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { runSync } from '@/lib/integrations/sync';

export async function enqueueJob(params: {
  companyId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  runAfter?: string;
  maxAttempts?: number;
}) {
  await createSupabaseServiceClient().from('background_jobs').insert({
    company_id: params.companyId ?? null,
    type: params.type,
    payload_json: params.payload ?? {},
    run_after: params.runAfter ?? new Date().toISOString(),
    max_attempts: params.maxAttempts ?? 3,
  });
}

async function executeJob(type: string, payload: Record<string, unknown>) {
  if (type === 'integration.sync' && typeof payload.integrationId === 'string') {
    await runSync(payload.integrationId);
    return;
  }
  if (type === 'email.send' && typeof payload.to === 'string' && typeof payload.subject === 'string' && typeof payload.html === 'string') {
    await sendEmail({ to: payload.to, subject: payload.subject, html: payload.html });
    return;
  }
  if (type === 'noop') return;
  throw new Error(`Unknown job type: ${type}`);
}

export async function processDueJobs(limit = 25): Promise<{ processed: number; failed: number; deadLettered: number }> {
  const sb = createSupabaseServiceClient();
  const { data: jobs } = await sb
    .from('background_jobs')
    .select('*')
    .eq('status', 'queued')
    .lte('run_after', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const job of (jobs ?? []) as Array<Record<string, unknown>>) {
    const id = job.id as string;
    const attempts = Number(job.attempts ?? 0) + 1;
    const maxAttempts = Number(job.max_attempts ?? 3);
    await sb.from('background_jobs').update({ status: 'running', attempts, locked_at: new Date().toISOString() }).eq('id', id);
    try {
      await executeJob(job.type as string, (job.payload_json as Record<string, unknown>) ?? {});
      await sb.from('background_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempts >= maxAttempts) {
        await sb.from('background_jobs').update({ status: 'dead_letter', last_error: message }).eq('id', id);
        await sb.from('dead_letter_jobs').insert({
          original_job_id: id,
          company_id: job.company_id ?? null,
          type: job.type,
          payload_json: job.payload_json ?? {},
          error_message: message,
        });
        deadLettered++;
      } else {
        await sb
          .from('background_jobs')
          .update({
            status: 'queued',
            last_error: message,
            run_after: new Date(Date.now() + attempts * 60_000).toISOString(),
          })
          .eq('id', id);
        failed++;
      }
    }
  }
  return { processed, failed, deadLettered };
}
