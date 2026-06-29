'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const campaignSchema = z.object({
  id: optText,
  name: z.string().min(1, 'Name is required').max(120),
  message: z.string().min(1, 'Message is required').max(500),
  matchUrl: optText,
  delaySeconds: z.coerce.number().int().min(0).max(600).catch(8),
  autoOpen: z.preprocess((x) => x === 'on', z.boolean()),
  status: z.enum(['active', 'paused', 'draft']).default('active'),
});

export async function saveCampaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = campaignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid campaign' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  const row = {
    company_id: companyId,
    name: v.name,
    message: v.message,
    match_url: v.matchUrl ?? null,
    delay_seconds: v.delaySeconds,
    auto_open: v.autoOpen,
    status: v.status,
    type: 'web_proactive',
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const { error } = await sb.from('proactive_campaigns').update(row).eq('company_id', companyId).eq('id', v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('proactive_campaigns').insert(row);
    if (error) return { error: error.message };
  }
  revalidatePath('/company/campaigns');
  return { ok: true };
}

export async function toggleCampaignAction(formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = z.enum(['active', 'paused']).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Invalid request' };
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('proactive_campaigns')
    .update({ status: status.data, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', id.data);
  if (error) return { error: error.message };
  revalidatePath('/company/campaigns');
  return { ok: true };
}

export async function deleteCampaignAction(formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Invalid id' };
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('proactive_campaigns').delete().eq('company_id', companyId).eq('id', id.data);
  if (error) return { error: error.message };
  revalidatePath('/company/campaigns');
  return { ok: true };
}
