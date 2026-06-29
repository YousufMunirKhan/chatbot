'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

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
  const days = formData
    .getAll('days')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = String(formData.get('start') ?? '09:00');
  const end = String(formData.get('end') ?? '17:00');
  const timezone = String(formData.get('timezone') ?? 'UTC').slice(0, 64);
  const businessHours = {
    enabled: formData.get('businessHoursEnabled') === 'on',
    days: days.length ? days : [1, 2, 3, 4, 5],
    start: timeRe.test(start) ? start : '09:00',
    end: timeRe.test(end) ? end : '17:00',
    timezone,
  };

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('company_settings').upsert(
    [
      { company_id: companyId, key: 'sla_response_minutes', value_json: slaMinutes },
      { company_id: companyId, key: 'routing_strategy', value_json: routingStrategy },
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
