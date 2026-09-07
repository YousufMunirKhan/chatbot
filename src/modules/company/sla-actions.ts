'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optNumber = z.preprocess(
  (x) => (x === '' || x == null ? undefined : Number(x)),
  z.number().int().positive().optional(),
);

const policySchema = z.object({
  id: optText,
  name: z.string().min(2, 'Give the policy a name').max(100),
  appliesPriority: optText,
  appliesChannel: optText,
  firstResponseMinutes: z.coerce.number().int().positive('First response target must be at least 1 minute'),
  resolutionMinutes: optNumber,
  businessHoursOnly: z.coerce.boolean().optional(),
  escalateBeforeMinutes: optNumber,
  escalateToUserId: optText,
  priority: z.coerce.number().int().min(0).max(100).optional(),
});

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export async function saveSlaPolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = policySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid policy' };
  const v = parsed.data;

  if (v.appliesPriority && !PRIORITIES.includes(v.appliesPriority)) {
    return { error: 'Unknown priority.' };
  }
  if (v.resolutionMinutes && v.resolutionMinutes < v.firstResponseMinutes) {
    return { error: 'The resolution target cannot be shorter than the first-response target.' };
  }
  if (v.escalateBeforeMinutes && v.escalateBeforeMinutes >= v.firstResponseMinutes) {
    return { error: 'Warn earlier than the first-response target, not after it.' };
  }

  const sb = createSupabaseServiceClient();

  // TENANT ISOLATION: an escalation target must be a member of this company.
  if (v.escalateToUserId) {
    const { data: member } = await sb
      .from('company_users')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('user_id', v.escalateToUserId)
      .maybeSingle();
    if (!member) return { error: 'That team member was not found in your company.' };
  }

  const values = {
    company_id: companyId,
    name: v.name.trim(),
    applies_priority: v.appliesPriority ?? null,
    applies_channel: v.appliesChannel ?? null,
    first_response_minutes: v.firstResponseMinutes,
    resolution_minutes: v.resolutionMinutes ?? null,
    business_hours_only: Boolean(v.businessHoursOnly),
    escalate_before_minutes: v.escalateBeforeMinutes ?? null,
    escalate_to_user_id: v.escalateToUserId ?? null,
    priority: v.priority ?? 0,
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const { error } = await sb
      .from('sla_policies')
      .update(values)
      .eq('company_id', companyId)
      .eq('id', v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('sla_policies').insert(values);
    if (error) return { error: error.message };
  }

  revalidatePath('/company/sla');
  return { ok: true };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function toggleSlaPolicyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const active = formData.get('active') === 'true';
  const sb = createSupabaseServiceClient();
  await sb
    .from('sla_policies')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', parsed.data.id);
  revalidatePath('/company/sla');
}

export async function deleteSlaPolicyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('sla_policies').delete().eq('company_id', companyId).eq('id', parsed.data.id);
  revalidatePath('/company/sla');
}

/**
 * Three policies that match how most support teams actually work: a fast lane
 * for urgent, a standard lane, and a slower one for email. Created only when the
 * company has none, so the button is safe to press twice.
 */
export async function seedDefaultSlaPoliciesAction(): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: existing } = await sb
    .from('sla_policies')
    .select('id')
    .eq('company_id', companyId)
    .limit(1);
  if ((existing ?? []).length > 0) return { error: 'You already have SLA policies.' };

  const { error } = await sb.from('sla_policies').insert([
    {
      company_id: companyId,
      name: 'Urgent — 5 minute response',
      applies_priority: 'urgent',
      first_response_minutes: 5,
      resolution_minutes: 120,
      escalate_before_minutes: 2,
      priority: 30,
    },
    {
      company_id: companyId,
      name: 'Email — 4 hour response',
      applies_channel: 'email',
      first_response_minutes: 240,
      resolution_minutes: 1440,
      business_hours_only: true,
      escalate_before_minutes: 30,
      priority: 20,
    },
    {
      company_id: companyId,
      name: 'Standard — 15 minute response',
      first_response_minutes: 15,
      resolution_minutes: 480,
      business_hours_only: true,
      escalate_before_minutes: 5,
      priority: 0,
    },
  ]);
  if (error) return { error: error.message };

  revalidatePath('/company/sla');
  return { ok: true };
}
