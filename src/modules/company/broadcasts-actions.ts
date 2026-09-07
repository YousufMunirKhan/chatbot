'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const schema = z.object({
  channel: z.enum(['whatsapp', 'email']),
  subject: optText,
  // A template-only WhatsApp broadcast still stores the body as the fallback
  // text used inside the 24h window, so the field stays required.
  message: z.string().min(1, 'Message is required').max(2000),
  scheduleAt: optText,
  scheduledTimezone: optText,
  audience: z.enum(['all_leads', 'opted_in', 'tag', 'segment', 'custom']).default('all_leads'),
  audienceTag: optText,
  audienceStatus: optText,
  audienceContacts: optText,
  templateName: optText,
  templateLanguage: optText,
  templateVariables: optText,
});

export async function createBroadcastAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('broadcasts'))) {
    return { error: 'Your plan does not include Bulk messages. See Billing to change your package.' };
  }
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid broadcast' };
  const v = parsed.data;

  let scheduleAt: string | null = null;
  if (v.scheduleAt) {
    const d = new Date(v.scheduleAt);
    if (!Number.isNaN(d.getTime())) scheduleAt = d.toISOString();
  }

  // Audience filters are stored as a small jsonb blob rather than columns, so a
  // new targeting mode does not need another migration.
  const audienceFilter: Record<string, unknown> = {};
  if (v.audience === 'tag') {
    if (!v.audienceTag) return { error: 'Enter the conversation tag to target.' };
    audienceFilter.tag = v.audienceTag.trim();
  }
  if (v.audience === 'segment') {
    if (!v.audienceStatus) return { error: 'Choose the lead status to target.' };
    audienceFilter.status = v.audienceStatus.trim();
  }
  if (v.audience === 'custom') {
    const contacts = (v.audienceContacts ?? '')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (contacts.length === 0) return { error: 'Add at least one contact for a custom audience.' };
    audienceFilter.contacts = contacts;
  }

  const templateName = v.channel === 'whatsapp' ? (v.templateName ?? '').trim() || null : null;
  const templateVariables = templateName
    ? (v.templateVariables ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // TENANT ISOLATION: only allow a template this company owns, and only an
  // approved one — Meta rejects anything else at send time.
  const sb = createSupabaseServiceClient();
  let templateLanguage: string | null = null;
  if (templateName) {
    const { data: tpl } = await sb
      .from('whatsapp_templates')
      .select('language,status')
      .eq('company_id', companyId)
      .eq('name', templateName)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();
    if (!tpl) return { error: 'That template is not approved yet, so Meta would reject the send.' };
    templateLanguage = (v.templateLanguage ?? '').trim() || ((tpl as { language: string }).language ?? 'en_US');
  }

  const { error } = await sb.from('broadcasts').insert({
    company_id: companyId,
    channel: v.channel,
    subject: v.channel === 'email' ? v.subject ?? null : null,
    message: v.message,
    audience: v.audience,
    audience_filter: audienceFilter,
    template_name: templateName,
    template_language: templateLanguage,
    template_variables: templateName ? templateVariables : null,
    scheduled_timezone: v.scheduledTimezone ?? null,
    schedule_at: scheduleAt,
    status: 'scheduled',
  });
  if (error) return { error: error.message };
  revalidatePath('/company/broadcasts');
  return { ok: true };
}

export async function deleteBroadcastAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  await requireCompanyFeature('broadcasts');
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
