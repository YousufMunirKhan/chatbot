import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { getPlatformEmailSettings } from '@/lib/platform-settings';
import {
  REPORT_TABS,
  computeNextRunAt,
  deliverScheduledReport,
  getCompanySendContext,
  isReportTab,
  type ScheduleCadence,
} from '@/modules/company/reports-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Schedules processed per run. Each one is a report build plus an email. */
const MAX_PER_RUN = 50;

interface ScheduleRow {
  id: string;
  company_id: string;
  name: string;
  tab: string;
  range_key: string;
  frequency: string;
  day_of_week: number;
  day_of_month: number;
  send_hour: number;
  recipients: string[] | null;
}

/**
 * Scheduled report sweep.
 *
 * Sends every report whose time has come. `next_run_at` is stored on the row,
 * so finding work is an index scan over "active and due before now"
 * (`idx_report_schedules_due`) rather than loading every schedule on the
 * platform and doing calendar arithmetic to discard almost all of them — the
 * same shape the SLA sweep uses.
 *
 * RUN IT HOURLY. Schedules land on the hour in the company's own timezone, and
 * a sweep that runs less often than the finest granularity a schedule can
 * express would deliver "07:00" at half past nine.
 *
 * WHY `next_run_at` MOVES EVEN WHEN NOTHING WAS SENT
 * A company with no email provider, or a schedule whose only recipient bounces,
 * would otherwise stay permanently due and be retried on every single tick —
 * one delivery row per hour, forever, burying the history that makes the
 * failure visible in the first place. The attempt is recorded with its reason
 * and the schedule moves on to its next slot, which is also what the person
 * reading the Recent sends table expects to see: one line per intended send.
 *
 * Protect with CRON_SECRET; see the `vercel.json` entry in this change's notes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: 'cron_not_configured' }, 503);
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (provided !== secret) return json({ error: 'unauthorized' }, 401);

  const sb = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await sb
    .from('report_schedules')
    .select(
      'id,company_id,name,tab,range_key,frequency,day_of_week,day_of_month,send_hour,recipients',
    )
    .eq('is_active', true)
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    logger.error('Report sweep could not list due schedules', { error: error.message });
    return json({ error: 'query_failed' }, 500);
  }

  const due = (data ?? []) as ScheduleRow[];
  if (due.length === 0) return json({ ok: true, due: 0, sent: 0, skipped: 0, failed: 0 });

  // Asked once for the whole sweep rather than once per schedule: it is a
  // platform-wide setting and cannot change halfway through a run.
  const settings = await getPlatformEmailSettings();
  const emailConfigured = Boolean(settings.enabled && settings.fromEmail);

  // One company usually owns several schedules; its name and timezone are read
  // once and reused, so ten schedules cost one lookup rather than ten.
  const contexts = new Map<string, { companyName: string; offsetMinutes: number }>();
  const contextFor = async (companyId: string) => {
    const cached = contexts.get(companyId);
    if (cached) return cached;
    const fresh = await getCompanySendContext(companyId);
    contexts.set(companyId, fresh);
    return fresh;
  };

  const counts: Record<'sent' | 'skipped' | 'failed', number> = { sent: 0, skipped: 0, failed: 0 };

  for (const row of due) {
    const cadence: ScheduleCadence = {
      frequency: row.frequency as ScheduleCadence['frequency'],
      dayOfWeek: row.day_of_week,
      dayOfMonth: row.day_of_month,
      sendHour: row.send_hour,
    };

    let context = { companyName: 'Your company', offsetMinutes: 0 };
    try {
      context = await contextFor(row.company_id);
      const outcome = await deliverScheduledReport(
        {
          id: row.id,
          companyId: row.company_id, // taken off the schedule row, never from a request
          name: row.name,
          tab: isReportTab(row.tab) ? row.tab : REPORT_TABS[0].key,
          rangeKey: row.range_key,
          recipients: row.recipients ?? [],
          ...cadence,
        },
        { ...context, emailConfigured },
      );
      counts[outcome.status] += 1;
    } catch (err) {
      // One broken schedule must not stop the sweep for everybody else.
      counts.failed += 1;
      logger.error('Scheduled report threw', {
        scheduleId: row.id,
        companyId: row.company_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const { error: updateError } = await sb
      .from('report_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: computeNextRunAt(cadence, context.offsetMinutes),
      })
      .eq('id', row.id);
    if (updateError) {
      // Left due on purpose rather than skipped: the next tick retries it, and
      // an unmoved `next_run_at` is the signal that this write is failing.
      logger.error('Could not advance a report schedule', {
        scheduleId: row.id,
        error: updateError.message,
      });
    }
  }

  return json({ ok: true, due: due.length, emailConfigured, ...counts });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
