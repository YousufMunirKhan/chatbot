'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { normalizeWhatsAppNumber } from '@/lib/channels/whatsapp';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const createSchema = z.object({
  channel: z.enum(['whatsapp', 'instagram', 'email']),
  provider: z.enum(['meta_cloud', 'twilio']).default('meta_cloud'),
  externalId: z.string().min(1, 'Address / id is required').max(200),
  secret: optText,
  botId: optText,
});

export async function createChannelIdentityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid channel' };
  const v = parsed.data;
  const isTwilioWhatsApp = v.channel === 'whatsapp' && v.provider === 'twilio';

  // Token rules: Meta WhatsApp + Instagram need a send token; Twilio inbound
  // replies via TwiML (no token); email never needs one.
  if (v.channel === 'instagram' && !v.secret) {
    return { error: 'A page access token is required for Instagram.' };
  }
  if (v.channel === 'whatsapp' && v.provider === 'meta_cloud' && !v.secret) {
    return { error: 'An access token is required for WhatsApp Cloud API.' };
  }

  // Normalise the external id so the webhook lookups match: email lowercased,
  // Twilio WhatsApp to "+digits" (Twilio sends the business number, not an id).
  let externalId = v.externalId.trim();
  if (v.channel === 'email') externalId = externalId.toLowerCase();
  else if (isTwilioWhatsApp) externalId = normalizeWhatsAppNumber(externalId);

  const settings = v.channel === 'whatsapp' ? { provider: v.provider } : {};

  const sb = createSupabaseServiceClient();

  // TENANT ISOLATION: only allow attaching a bot that belongs to this company.
  if (v.botId) {
    const { data: owned } = await sb
      .from('bots')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', v.botId)
      .maybeSingle();
    if (!owned) return { error: 'Selected assistant was not found for your company.' };
  }

  // TENANT ISOLATION: a channel address (phone/email/page) maps to ONE tenant
  // globally so inbound webhooks route unambiguously. Refuse to overwrite a
  // mapping owned by another company (prevents channel hijacking).
  const { data: existing } = await sb
    .from('channel_identities')
    .select('id,company_id')
    .eq('channel', v.channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (existing && (existing as { company_id: string }).company_id !== companyId) {
    return { error: 'This address is already connected to another account. Contact support if this is yours.' };
  }

  const { error } = await sb.from('channel_identities').upsert(
    {
      company_id: companyId,
      bot_id: v.botId ?? null,
      channel: v.channel,
      external_id: externalId,
      secret_encrypted: v.secret ? encryptSecret(v.secret) : null,
      settings_json: settings,
      is_active: true,
    },
    { onConflict: 'channel,external_id' },
  );
  if (error) return { error: error.message };

  revalidatePath('/company/channels');
  return { ok: true };
}

export async function toggleChannelIdentityAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  const active = formData.get('active') === 'true';
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('channel_identities')
    .update({ is_active: active })
    .eq('company_id', companyId)
    .eq('id', id.data);
  revalidatePath('/company/channels');
}

export async function deleteChannelIdentityAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('channel_identities').delete().eq('company_id', companyId).eq('id', id.data);
  revalidatePath('/company/channels');
}
