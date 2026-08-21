'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';
import type { BusinessHours } from './support-settings-data';

export type ActionState = { error?: string; ok?: boolean };

const retentionSchema = z.object({
  retentionDays: z.coerce.number().int().min(1).max(3650).catch(30),
});

export async function updateRetentionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = retentionSchema.safeParse(Object.fromEntries(formData));
  const retentionDays = parsed.success ? parsed.data.retentionDays : 30;

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('company_settings')
    .upsert(
      { company_id: companyId, key: 'chat_retention_days', value_json: retentionDays },
      { onConflict: 'company_id,key' },
    );
  if (error) return { error: error.message };

  revalidatePath('/company/settings');
  return { ok: true };
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateSupportSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const slaMinutes = Math.min(1440, Math.max(1, Number(formData.get('slaResponseMinutes')) || 5));
  const routingStrategy = formData.get('routingStrategy') === 'round_robin' ? 'round_robin' : 'most_recent';
  const autoTicketConnectorFailures = formData.get('autoTicketConnectorFailures') === 'on';
  const connectorDelayMinutes = Math.min(1440, Math.max(1, Number(formData.get('connectorFailureTicketDelayMinutes')) || 5));
  const days = formData
    .getAll('days')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = String(formData.get('start') ?? '09:00');
  const end = String(formData.get('end') ?? '17:00');

  const sb = createSupabaseServiceClient();

  // Issue #16/#31: the weekly schedule belongs to `company_business_hours` (Business
  // Data) and the timezone to `companies.timezone`, so once those hour rows exist this
  // form only owns the on/off toggle — writing a second schedule here is what let the
  // bot say "we're open" while SLA tracking treated the business as closed. Companies
  // with no hour rows yet keep editing the legacy JSON schedule so their SLA behaviour
  // does not change, and keep their stored timezone (this form no longer asks for it).
  const [{ count: hourRowCount }, { data: storedHours }] = await Promise.all([
    sb
      .from('company_business_hours')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('location_id', null),
    sb
      .from('company_settings')
      .select('value_json')
      .eq('company_id', companyId)
      .eq('key', 'business_hours')
      .maybeSingle(),
  ]);

  const enabled = formData.get('businessHoursEnabled') === 'on';
  const previous = ((storedHours as { value_json?: unknown } | null)?.value_json ?? {}) as Partial<BusinessHours>;
  const businessHours =
    (hourRowCount ?? 0) > 0
      ? { enabled }
      : {
          enabled,
          days: days.length ? days : [1, 2, 3, 4, 5],
          start: timeRe.test(start) ? start : '09:00',
          end: timeRe.test(end) ? end : '17:00',
          ...(typeof previous.timezone === 'string' && previous.timezone.trim()
            ? { timezone: previous.timezone }
            : {}),
        };

  const { error } = await sb.from('company_settings').upsert(
    [
      { company_id: companyId, key: 'sla_response_minutes', value_json: slaMinutes },
      { company_id: companyId, key: 'routing_strategy', value_json: routingStrategy },
      { company_id: companyId, key: 'auto_ticket_connector_failures', value_json: autoTicketConnectorFailures },
      { company_id: companyId, key: 'connector_failure_ticket_delay_minutes', value_json: connectorDelayMinutes },
      { company_id: companyId, key: 'business_hours', value_json: businessHours },
    ],
    { onConflict: 'company_id,key' },
  );
  if (error) return { error: error.message };

  revalidatePath('/company/support-settings');
  revalidatePath('/company/inbox');
  return { ok: true };
}

const requestSchema = z.object({
  requesterEmail: z.string().email('Valid email required'),
  requestType: z.enum(['export', 'delete']),
  notes: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional()),
});

export async function createDataRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const { error } = await createSupabaseServiceClient().from('data_subject_requests').insert({
    company_id: companyId,
    requester_email: v.requesterEmail,
    request_type: v.requestType,
    notes: v.notes ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath('/company/settings');
  return { ok: true };
}
