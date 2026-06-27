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
