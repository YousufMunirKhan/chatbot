import { CHANNEL_DESCRIPTORS, getChannelDescriptor } from '@/lib/channels/registry';
import { channelWebhookUrl } from '@/lib/channels/webhook-route';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { getCompanyId } from './data';

/** Channels that receive public comments and so expose comment-reply settings. */
export const COMMENT_CHANNELS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;

export type CommentReplyMode = 'private_with_ack' | 'public' | 'off';

export const DEFAULT_COMMENT_ACK = 'Thanks for reaching out — we just sent you a direct message.';

export interface ChannelIdentityRow {
  id: string;
  channel: string;
  /** Human label from CHANNEL_DESCRIPTORS, e.g. "Facebook (Messenger + Feed)". */
  channelLabel: string;
  externalId: string;
  displayName: string | null;
  botId: string | null;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
  /** The exact URL to paste into the provider's console, `?id=` included. */
  webhookUrl: string;
  /** Verify token the provider's handshake expects, when it uses one. */
  verifyToken: string | null;
  supportsComments: boolean;
  commentReply: CommentReplyMode;
  commentAck: string;
  /** `gmail` for an OAuth-connected mailbox, `inbound_parse` otherwise. */
  provider: string | null;
  /** LINE stores its send token separately from the signing channel secret. */
  hasAccessToken: boolean;
  /**
   * Whether the credential was proven to work when it was saved. 'unverified'
   * means the provider offers no way to check it, not that it failed; 'unknown'
   * means this channel predates the check.
   */
  health: 'ok' | 'unverified' | 'unknown';
  /** What the provider calls this account, when it told us. */
  accountName: string | null;
}

function appUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}

/**
 * The verify token a provider echoes back during its GET handshake.
 *
 * Only the Meta channels use one. It is an app-level value from the
 * environment, so it is read here (server side) and rendered on the Channels
 * screen where the admin has to paste it into the provider's console.
 */
function verifyTokenFor(channel: string): string | null {
  if (channel === 'whatsapp') return process.env.WHATSAPP_VERIFY_TOKEN ?? null;
  if (channel === 'instagram') {
    return process.env.INSTAGRAM_VERIFY_TOKEN ?? process.env.WHATSAPP_VERIFY_TOKEN ?? null;
  }
  if (channel === 'facebook') {
    return (
      process.env.META_VERIFY_TOKEN ??
      process.env.FACEBOOK_VERIFY_TOKEN ??
      process.env.WHATSAPP_VERIFY_TOKEN ??
      null
    );
  }
  return null;
}

function commentMode(value: unknown): CommentReplyMode {
  return value === 'public' || value === 'off' ? value : 'private_with_ack';
}

export async function listChannelIdentities(): Promise<ChannelIdentityRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('id,channel,external_id,display_name,bot_id,is_active,secret_encrypted,settings_json,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);

  const base = appUrl();
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    const channel = x.channel as string;
    const externalId = x.external_id as string;
    const settings = (x.settings_json as Record<string, unknown>) ?? {};
    return {
      id: x.id as string,
      channel,
      channelLabel: getChannelDescriptor(channel)?.label ?? channel,
      externalId,
      displayName: (x.display_name as string) ?? null,
      botId: (x.bot_id as string) ?? null,
      isActive: x.is_active !== false,
      hasSecret: Boolean(x.secret_encrypted),
      createdAt: x.created_at as string,
      webhookUrl: channelWebhookUrl(channel, externalId, base),
      verifyToken: verifyTokenFor(channel),
      supportsComments: (COMMENT_CHANNELS as readonly string[]).includes(channel),
      commentReply: commentMode(settings.commentReply),
      commentAck: (settings.commentAck as string) ?? DEFAULT_COMMENT_ACK,
      provider: (settings.provider as string) ?? null,
      hasAccessToken: Boolean(settings.accessToken),
      health:
        settings.health === 'ok' ? 'ok' : settings.health === 'unverified' ? 'unverified' : 'unknown',
      accountName: (settings.accountName as string) ?? null,
    };
  });
}

export interface ChannelFormDescriptor {
  key: string;
  label: string;
  externalIdHint: string;
  secretLabel: string;
  secretRequired: boolean;
  identityInUrl: boolean;
  webhookUrl: string;
  docsHint: string;
  /** LINE only: a second credential is needed to send replies. */
  needsAccessToken: boolean;
}

/**
 * Everything the connect form needs, derived from CHANNEL_DESCRIPTORS so a new
 * channel appears in the picker the moment it is registered.
 */
export function channelFormDescriptors(): ChannelFormDescriptor[] {
  const base = appUrl();
  return CHANNEL_DESCRIPTORS.map((d) => ({
    key: d.key,
    label: d.label,
    externalIdHint: d.externalIdHint,
    secretLabel: d.secretLabel,
    secretRequired: d.secretRequired,
    identityInUrl: d.identityInUrl,
    webhookUrl: `${base}${d.webhookPath}${d.identityInUrl ? '?id=<your id>' : ''}`,
    docsHint: d.docsHint,
    needsAccessToken: d.key === 'line',
  }));
}
