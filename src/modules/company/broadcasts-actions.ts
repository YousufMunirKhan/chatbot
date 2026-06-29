'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const schema = z.object({
  channel: z.enum(['whatsapp', 'email']),
  subject: optText,
  message: z.string().min(1, 'Message is required').max(2000),
  scheduleAt: optText,
});

export async function createBroadcastAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid broadcast' };
  const v = parsed.data;

  let scheduleAt: string | null = null;
  if (v.scheduleAt) {
    const d = new Date(v.scheduleAt);
    if (!Number.isNaN(d.getTime())) scheduleAt = d.toISOString();
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('broadcasts').insert({
    company_id: companyId,
    channel: v.channel,
    subject: v.channel === 'email' ? v.subject ?? null : null,
    message: v.message,
    audience: 'all_leads',
    schedule_at: scheduleAt,
    status: 'scheduled',
  });
  if (error) return { error: error.message };
  revalidatePath('/company/broadcasts');
  return { ok: true };
}

export async function deleteBroadcastAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  // Only scheduled broadcasts can be cancelled; sent ones stay as a record.
  await sb
    .from('broadcasts')
    .delete()
    .eq('company_id', companyId)
    .eq('id', id.data)
    .eq('status', 'scheduled');
  revalidatePath('/company/broadcasts');
}
