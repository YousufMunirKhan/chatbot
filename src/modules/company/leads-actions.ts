'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;

const updateStatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(LEAD_STATUSES),
});

export async function updateLeadStatusAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = updateStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('leads')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.leadId)
    .eq('company_id', companyId); // scope guard
  revalidatePath('/company/leads');
}

const addManualSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.preprocess((x) => (x === '' ? undefined : x), z.string().email('Valid email required').optional()),
  phone: optText,
  message: optText,
});

export async function addManualLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = addManualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('leads').insert({
    company_id: companyId,
    name: v.name,
    email: v.email ?? null,
    phone: v.phone ?? null,
    message: v.message ?? null,
    source: 'manual',
    status: 'new',
  });
  if (error) return { error: error.message };
  revalidatePath('/company/leads');
  return { ok: true };
}
