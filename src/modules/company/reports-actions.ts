'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getPlatformEmailSettings } from '@/lib/platform-settings';
import { logger } from '@/lib/logger';
import { getCompanyId } from './data';
import {
  MAX_RECIPIENTS,
  REPORT_TABS,
  SCHEDULABLE_RANGE_KEYS,
  SCHEDULE_FREQUENCIES,
  computeNextRunAt,
  deliverScheduledReport,
  getCompanyRangeOffset,
  getCompanySendContext,
  isReportTab,
  type ReportTab,
  type ScheduleCadence,
} from './reports-data';

export type ActionState = { error?: string; ok?: boolean; message?: string };

const REPORTS_PATH = '/company/reports';

/**
 * Scheduled report actions.
 *
 * Every one of these guards with `requireRole([COMPANY_ADMIN])` and then scopes
 * every statement to `getCompanyId()` — the company off the SESSION, never a
 * field in the form. The service client bypasses row-level security, so those
 * `.eq('company_id', …)` clauses are the isolation boundary rather than a
 * belt-and-braces extra.
 *
 * NO PLAN GATE. `src/lib/entitlements.ts` gates on the keys in
 * `PLAN_FEATURES` (whatsapp, flows, broadcasts, campaigns, api_access, agency,
 * custom_branding) and none of them covers reporting — reports have never been
 * a paid tier in this product. Adding a `scheduled_reports` key means editing
 * `src/modules/super-admin/plans.ts`, which this change does not own; if that
 * key is added later, the gate belongs in exactly two places: the Scheduled
 * panel on the page, and the top of `saveReportScheduleAction` and
 * `sendReportNowAction`, returning `{ error: … }` rather than throwing, because
 * a throw inside a `useFormState` action hits the error boundary instead of the
 * message the person is reading.
 */

const cadenceSchema = z.object({
  id: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().uuid().optional()),
  name: z.string().trim().min(2, 'Give this report a name.').max(80, 'That name is too long.'),
  tab: z.string(),
  rangeKey: z.string(),
  frequency: z.string(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).default(1),
  dayOfMonth: z.coerce.number().int().min(1, 'Pick a day between 1 and 28.').max(28, 'Pick a day between 1 and 28. A schedule set to the 30th would skip February.').default(1),
  sendHour: z.coerce.number().int().min(0).max(23).default(7),
  recipients: z.string().default(''),
});

const emailSchema = z.string().email();

/**
 * Split what someone typed into addresses.
 *
 * People paste lists in every shape a mail client produces, so commas,
 * semicolons, newlines and spaces are all separators. Duplicates are removed
 * case-insensitively — an address that appears twice would otherwise send the
 * same person the same report twice and count as two recipients against the cap.
 */
function parseRecipients(raw: string): { emails: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    const value = piece.trim();
    if (!value) continue;
    if (!emailSchema.safeParse(value).success) {
      invalid.push(value);
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(value);
  }
  return { emails, invalid };
}

export async function saveReportScheduleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const parsed = cadenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;

  if (!isReportTab(v.tab)) return { error: 'Pick one of the report sections.' };
  if (!(SCHEDULABLE_RANGE_KEYS as readonly string[]).includes(v.rangeKey)) {
    return { error: 'Pick a period that can be scheduled. Custom dates cannot: they would send the same numbers every time.' };
  }
  if (!SCHEDULE_FREQUENCIES.some((f) => f.key === v.frequency)) {
    return { error: 'Pick how often this should be sent.' };
  }

  const { emails, invalid } = parseRecipients(v.recipients);
  if (invalid.length > 0) {
    return { error: `${invalid[0]} is not an email address.` };
  }
  if (emails.length === 0) {
    return { error: 'Add at least one email address to send this to.' };
  }
  // A cap, not a preference. This is a form that emails arbitrary addresses on
  // a timer, so an unbounded recipient list is a mailing list somebody else is
  // paying for.
  if (emails.length > MAX_RECIPIENTS) {
    return { error: `A schedule can have at most ${MAX_RECIPIENTS} recipients. Send to a group address if you need more.` };
  }

  const cadence: ScheduleCadence = {
    frequency: v.frequency as ScheduleCadence['frequency'],
    dayOfWeek: v.dayOfWeek,
    dayOfMonth: v.dayOfMonth,
    sendHour: v.sendHour,
  };

  const sb = createSupabaseServiceClient();
  const values = {
    company_id: companyId,
    name: v.name,
    tab: v.tab satisfies ReportTab,
    range_key: v.rangeKey,
    frequency: cadence.frequency,
    day_of_week: cadence.dayOfWeek,
    day_of_month: cadence.dayOfMonth,
    send_hour: cadence.sendHour,
    recipients: emails,
    // Recomputed on every save, so changing the hour or the day takes effect
    // now rather than after one more send at the old time.
    next_run_at: computeNextRunAt(cadence, await getCompanyRangeOffset()),
  };

  if (v.id) {
    const { error } = await sb
      .from('report_schedules')
      .update(values)
      .eq('id', v.id)
      .eq('company_id', companyId); // scope guard
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('report_schedules').insert(values);
    if (error) return { error: error.message };
  }

  revalidatePath(REPORTS_PATH);

  // A schedule saves whether or not the platform can send email — losing
  // somebody's configuration because a provider is missing would be the wrong
  // failure — but it says so instead of implying an email is on its way.
  const settings = await getPlatformEmailSettings();
  if (!settings.enabled || !settings.fromEmail) {
    return {
      ok: true,
      message:
        'Saved. No email provider is configured on this platform yet, so nothing will be sent until one is — the schedule is kept and every skipped run is listed under Recent sends.',
    };
  }
  return { ok: true, message: 'Saved.' };
}

/** Pause or resume one schedule. */
export async function toggleReportScheduleAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = String(formData.get('id') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!z.string().uuid().safeParse(id).success) return;

  const sb = createSupabaseServiceClient();
  const patch: Record<string, unknown> = { is_active: active };
  // Resuming a schedule that was paused for a month must not fire immediately
  // for every run it missed: the next due time is recomputed from now.
  if (active) {
    const { data } = await sb
      .from('report_schedules')
      .select('frequency,day_of_week,day_of_month,send_hour')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();
    const row = data as {
      frequency?: string;
      day_of_week?: number;
      day_of_month?: number;
      send_hour?: number;
    } | null;
    if (row) {
      patch.next_run_at = computeNextRunAt(
        {
          frequency: (row.frequency ?? 'weekly') as ScheduleCadence['frequency'],
          dayOfWeek: row.day_of_week ?? 1,
          dayOfMonth: row.day_of_month ?? 1,
          sendHour: row.send_hour ?? 7,
        },
        await getCompanyRangeOffset(),
      );
    }
  }

  await sb.from('report_schedules').update(patch).eq('id', id).eq('company_id', companyId);
  revalidatePath(REPORTS_PATH);
}

export async function deleteReportScheduleAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return;

  const sb = createSupabaseServiceClient();
  // `report_deliveries.schedule_id` is `on delete set null`, so the history of
  // what was already sent survives this — deleting a schedule must not erase
  // the evidence of the emails it produced.
  await sb.from('report_schedules').delete().eq('id', id).eq('company_id', companyId);
  revalidatePath(REPORTS_PATH);
}

/**
 * Send one schedule right now, without waiting for its next run.
 *
 * The outcome is not returned to the caller because it does not need to be:
 * `deliverScheduledReport` writes a `report_deliveries` row for every attempt,
 * including the ones that did not send and why, and that table is on the same
 * screen directly below this button. One record of what happened, in one place,
 * whether the send came from the cron or from someone pressing a button.
 *
 * `next_run_at` is deliberately NOT advanced: a test send is not the scheduled
 * send, and swallowing Monday's report because someone checked the format on
 * Sunday would be a surprising way to lose it.
 */
export async function sendReportNowAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = String(formData.get('id') ?? '');
  if (!z.string().uuid().safeParse(id).success) return;

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('report_schedules')
    .select('id,name,tab,range_key,frequency,day_of_week,day_of_month,send_hour,recipients')
    .eq('id', id)
    .eq('company_id', companyId) // scope guard: only this company's schedules
    .maybeSingle();
  const row = data as {
    id: string;
    name: string;
    tab: string;
    range_key: string;
    frequency: string;
    day_of_week: number;
    day_of_month: number;
    send_hour: number;
    recipients: string[] | null;
  } | null;
  if (!row) return;

  const [{ companyName, offsetMinutes }, settings] = await Promise.all([
    getCompanySendContext(companyId),
    getPlatformEmailSettings(),
  ]);

  try {
    await deliverScheduledReport(
      {
        id: row.id,
        companyId,
        name: row.name,
        tab: isReportTab(row.tab) ? row.tab : REPORT_TABS[0].key,
        rangeKey: row.range_key,
        recipients: row.recipients ?? [],
        frequency: row.frequency as ScheduleCadence['frequency'],
        dayOfWeek: row.day_of_week,
        dayOfMonth: row.day_of_month,
        sendHour: row.send_hour,
      },
      {
        companyName,
        offsetMinutes,
        emailConfigured: Boolean(settings.enabled && settings.fromEmail),
      },
    );
  } catch (err) {
    // The delivery recorder swallows send failures on purpose; anything that
    // still escapes is a bug worth a log line, not a broken page.
    logger.error('Manual report send threw', {
      scheduleId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(REPORTS_PATH);
}
