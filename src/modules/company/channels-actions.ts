'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { setTelegramWebhook } from '@/lib/channels/adapters/telegram';
import { setViberWebhook } from '@/lib/channels/adapters/viber';
import { getChannelAdapter, getChannelDescriptor } from '@/lib/channels/registry';
import { probeChannelCredential } from '@/lib/channels/probe';
import { channelWebhookUrl } from '@/lib/channels/webhook-route';
import { textBlocks, type ChannelSendContext, type ChannelKey } from '@/lib/channels/types';
import { normalizeWhatsAppNumber } from '@/lib/channels/whatsapp';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean; message?: string };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const CHANNELS = [
  'whatsapp',
  'instagram',
  'facebook',
  'email',
  'telegram',
  'viber',
  'line',
  'tiktok',
  'youtube',
] as const;

const createSchema = z.object({
  channel: z.enum(CHANNELS),
  provider: z.enum(['meta_cloud', 'twilio']).default('meta_cloud'),
  externalId: z.string().min(1, 'Address / id is required').max(200),
  displayName: optText,
  secret: optText,
  /** LINE: the channel access token used to send, separate from the secret. */
  accessToken: optText,
  botId: optText,
});

function appUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}

function decrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return value; // tolerate a plaintext token stored in dev/test
  }
}

export async function createChannelIdentityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid channel' };
  const v = parsed.data;
  const descriptor = getChannelDescriptor(v.channel);
  if (!descriptor) return { error: 'Unknown channel.' };
  const isTwilioWhatsApp = v.channel === 'whatsapp' && v.provider === 'twilio';

  // Token rules. Twilio WhatsApp answers inbound with TwiML so it needs no
  // token, and inbound-parse email never does; every other channel has to be
  // able to send, so its credential is required.
  if (descriptor.secretRequired && !isTwilioWhatsApp && !v.secret) {
    return { error: `${descriptor.secretLabel} is required for ${descriptor.label}.` };
  }
  if (v.channel === 'line' && !v.accessToken) {
    return { error: 'A channel access token is required for LINE — replies are sent with it.' };
  }

  // Normalise the external id so webhook lookups match: email lowercased,
  // Twilio WhatsApp to "+digits" (Twilio sends the business number, not an id).
  let externalId = v.externalId.trim();
  if (v.channel === 'email') externalId = externalId.toLowerCase();
  else if (isTwilioWhatsApp) externalId = normalizeWhatsAppNumber(externalId);

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

  // TENANT ISOLATION: a channel address (phone/email/page/bot) maps to ONE
  // tenant globally so inbound webhooks route unambiguously. Refuse to
  // overwrite a mapping owned by another company (prevents channel hijacking).
  const { data: existing } = await sb
    .from('channel_identities')
    .select('id,company_id,settings_json')
    .eq('channel', v.channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (existing && (existing as { company_id: string }).company_id !== companyId) {
    return { error: 'This address is already connected to another account. Contact support if this is yours.' };
  }

  // Keep any comment-reply preferences already configured for this address.
  const previous = ((existing as { settings_json?: Record<string, unknown> } | null)?.settings_json ??
    {}) as Record<string, unknown>;
  const settings: Record<string, unknown> = { ...previous };
  if (v.channel === 'whatsapp') settings.provider = v.provider;
  if (v.channel === 'line' && v.accessToken) settings.accessToken = v.accessToken;

  // Check the credential actually works BEFORE saying "connected". A mistyped
  // token used to save silently and the channel simply never answered anyone —
  // indistinguishable, on screen, from a working channel with no customers.
  const probe = await probeChannelCredential({
    channel: v.channel,
    externalId,
    secret: v.secret ?? null,
    settings,
  });
  if (!probe.ok) return { error: probe.error ?? 'The provider refused that credential.' };

  settings.health = probe.unverifiable ? 'unverified' : 'ok';
  settings.healthCheckedAt = new Date().toISOString();
  if (probe.accountName) settings.accountName = probe.accountName;

  const { error } = await sb.from('channel_identities').upsert(
    {
      company_id: companyId,
      bot_id: v.botId ?? null,
      channel: v.channel,
      external_id: externalId,
      display_name: v.displayName ?? null,
      secret_encrypted: v.secret ? encryptSecret(v.secret) : null,
      settings_json: settings,
      is_active: true,
    },
    { onConflict: 'channel,external_id' },
  );
  if (error) return { error: error.message };

  revalidatePath('/company/channels');

  // Telegram and Viber only deliver to a webhook they have been told about, so
  // registering it is part of saving the channel rather than a manual step.
  const registration = await registerWebhook(v.channel, externalId, v.secret ?? null);
  if (registration) return { ok: true, error: registration };

  if (probe.unverifiable) {
    return {
      ok: true,
      message:
        'Saved. This provider gives us no way to check the credential, so send a test message to confirm it works.',
    };
  }
  return {
    ok: true,
    message: probe.accountName ? `Connected to ${probe.accountName}.` : 'Connected — the credential works.',
  };
}

/**
 * Point the provider at our webhook. Returns an error string when the provider
 * rejected the registration — the row is already saved at that point, so the
 * message tells the admin what is still missing rather than losing their input.
 */
async function registerWebhook(
  channel: ChannelKey,
  externalId: string,
  secret: string | null,
): Promise<string | null> {
  if (channel !== 'telegram' && channel !== 'viber') return null;
  if (!secret) return null;

  const url = channelWebhookUrl(channel, externalId, appUrl());
  if (!/^https:\/\//i.test(url)) {
    return `Channel saved. ${channel === 'telegram' ? 'Telegram' : 'Viber'} only accepts an HTTPS webhook, and NEXT_PUBLIC_APP_URL is "${appUrl()}" — register ${url} once the app is on a public HTTPS URL.`;
  }

  try {
    // Telegram's optional secret_token must be [A-Za-z0-9_-]{1,256}; a bot token
    // contains ":" so it cannot be reused as one. Registering without it is
    // Telegram's own default — the unguessable ?id plus the bot token is the
    // guard, and the adapter accepts a delivery that carries no such header.
    const ok =
      channel === 'telegram'
        ? await setTelegramWebhook(secret, url)
        : await setViberWebhook(secret, url);
    if (ok) return null;
    return `Channel saved, but ${channel === 'telegram' ? 'Telegram' : 'Viber'} rejected the webhook registration. Check the token, then set the webhook to ${url} manually.`;
  } catch (err) {
    logger.warn('Channel webhook registration threw', {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
    return `Channel saved, but the webhook could not be registered with ${channel === 'telegram' ? 'Telegram' : 'Viber'}. Set it to ${url} manually.`;
  }
}

const commentSchema = z.object({
  id: z.string().uuid(),
  commentReply: z.enum(['private_with_ack', 'public', 'off']),
  commentAck: z.string().max(500).optional(),
});

/**
 * Comment-reply behaviour for a feed channel. The inbound handler reads
 * `settings_json.commentReply` / `.commentAck`, so this writes exactly those.
 */
export async function updateChannelCommentSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  const v = parsed.data;

  const sb = createSupabaseServiceClient();
  // Company-scoped read: an id from another tenant simply is not found.
  const { data: row } = await sb
    .from('channel_identities')
    .select('id,settings_json')
    .eq('company_id', companyId)
    .eq('id', v.id)
    .maybeSingle();
  if (!row) return { error: 'Channel not found.' };

  const settings = ((row as { settings_json?: Record<string, unknown> }).settings_json ?? {}) as Record<
    string,
    unknown
  >;
  const { error } = await sb
    .from('channel_identities')
    .update({
      settings_json: {
        ...settings,
        commentReply: v.commentReply,
        ...(v.commentAck ? { commentAck: v.commentAck } : {}),
      },
    })
    .eq('company_id', companyId)
    .eq('id', v.id);
  if (error) return { error: error.message };

  revalidatePath('/company/channels');
  return { ok: true, message: 'Comment settings saved.' };
}

const testSchema = z.object({
  id: z.string().uuid(),
  to: z.string().min(1, 'Enter where the test should go').max(300),
  text: z.string().max(1000).optional(),
});

/**
 * Send one text message through the real adapter, so an admin can prove a
 * channel works before pointing customers at it.
 */
export async function sendChannelTestMessageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = testSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid test message' };
  const v = parsed.data;

  const sb = createSupabaseServiceClient();
  // TENANT ISOLATION: scoped by company, so one admin can never send from
  // another tenant's connected account.
  const { data: row } = await sb
    .from('channel_identities')
    .select('id,channel,external_id,secret_encrypted,settings_json,is_active')
    .eq('company_id', companyId)
    .eq('id', v.id)
    .maybeSingle();
  if (!row) return { error: 'Channel not found.' };
  const identity = row as {
    channel: string;
    external_id: string;
    secret_encrypted: string | null;
    settings_json: Record<string, unknown> | null;
    is_active: boolean | null;
  };
  if (identity.is_active === false) return { error: 'This channel is paused. Activate it first.' };

  const adapter = getChannelAdapter(identity.channel);
  if (!adapter) return { error: 'This channel has no adapter.' };

  const ctx: ChannelSendContext = {
    companyId,
    channel: adapter.key,
    externalId: identity.external_id,
    secret: decrypt(identity.secret_encrypted),
    settings: { ...(identity.settings_json ?? {}), subject: 'Test message' },
  };

  const text = v.text?.trim() || 'Test message from your AI assistant — this channel is connected.';
  try {
    const delivered = await adapter.send(ctx, v.to.trim(), textBlocks(text));
    return delivered
      ? { ok: true, message: `Sent to ${v.to.trim()}.` }
      : { error: 'The provider did not accept the message. Check the token and the recipient id.' };
  } catch (err) {
    logger.warn('Channel test message failed', {
      channel: identity.channel,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Sending failed. Check the credentials for this channel.' };
  }
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
