import { emailAdapter } from './adapters/email';
import { facebookAdapter, instagramAdapter } from './adapters/meta';
import { lineAdapter } from './adapters/line';
import { telegramAdapter } from './adapters/telegram';
import { tiktokAdapter } from './adapters/tiktok';
import { viberAdapter } from './adapters/viber';
import { whatsappAdapter } from './adapters/whatsapp';
import { youtubeAdapter } from './adapters/youtube';
// SMS lives one level up rather than under adapters/ because it needs the app's
// env and logger, and everything in adapters/ is deliberately dependency-free.
import { SMS_CHANNEL_DESCRIPTOR, smsAdapter } from './sms';
import { CHANNEL_KEYS } from './types';
import type { ChannelAdapter, ChannelKey } from './types';

const ADAPTERS: Record<ChannelKey, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  email: emailAdapter,
  telegram: telegramAdapter,
  viber: viberAdapter,
  line: lineAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  sms: smsAdapter,
};

export function getChannelAdapter(channel: string): ChannelAdapter | null {
  return (ADAPTERS as Record<string, ChannelAdapter | undefined>)[channel] ?? null;
}

export function isChannelKey(value: string): value is ChannelKey {
  return (CHANNEL_KEYS as readonly string[]).includes(value);
}

export function listChannelAdapters(): ChannelAdapter[] {
  return CHANNEL_KEYS.map((key) => ADAPTERS[key]);
}

/**
 * What the Channels screen needs to render a connect form for each channel:
 * the label, what to type into the id field, and what the secret means.
 */
export interface ChannelDescriptor {
  key: ChannelKey;
  label: string;
  externalIdHint: string;
  secretLabel: string;
  secretRequired: boolean;
  /** Whether the webhook URL must carry `?id=<external id>`. */
  identityInUrl: boolean;
  webhookPath: string;
  docsHint: string;
}

export const CHANNEL_DESCRIPTORS: ChannelDescriptor[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp Business',
    externalIdHint: 'Phone number id from WhatsApp Cloud API',
    secretLabel: 'Permanent access token',
    secretRequired: true,
    identityInUrl: false,
    webhookPath: '/api/webhooks/whatsapp',
    docsHint: 'Meta Business → WhatsApp → Configuration → Webhook.',
  },
  {
    key: 'instagram',
    label: 'Instagram (Direct + Feed)',
    externalIdHint: 'Instagram professional account id',
    secretLabel: 'Page access token',
    secretRequired: true,
    identityInUrl: false,
    webhookPath: '/api/webhooks/instagram',
    docsHint: 'Subscribe to the messages and comments fields on your Meta app.',
  },
  {
    key: 'facebook',
    label: 'Facebook (Messenger + Feed)',
    externalIdHint: 'Facebook Page id',
    secretLabel: 'Page access token',
    secretRequired: true,
    identityInUrl: false,
    webhookPath: '/api/webhooks/facebook',
    docsHint: 'Subscribe to the messages, messaging_postbacks and feed fields.',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    externalIdHint: 'Bot id — the digits before ":" in the BotFather token',
    secretLabel: 'Bot token',
    secretRequired: true,
    identityInUrl: true,
    webhookPath: '/api/webhooks/telegram',
    docsHint: 'Saving the channel registers the webhook with Telegram automatically.',
  },
  {
    key: 'viber',
    label: 'Viber',
    externalIdHint: 'Any stable id for this Public Account',
    secretLabel: 'Viber auth token',
    secretRequired: true,
    identityInUrl: true,
    webhookPath: '/api/webhooks/viber',
    docsHint: 'Saving the channel calls set_webhook on the Viber API for you.',
  },
  {
    key: 'line',
    label: 'LINE',
    externalIdHint: 'Bot user id (the "destination" LINE sends, starts with U)',
    secretLabel: 'Channel secret',
    secretRequired: true,
    identityInUrl: false,
    webhookPath: '/api/webhooks/line',
    docsHint: 'Also paste the channel access token — replies are sent with it.',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    externalIdHint: 'Creator open id of the connected TikTok account',
    secretLabel: 'TikTok access token',
    secretRequired: true,
    identityInUrl: true,
    webhookPath: '/api/webhooks/tiktok',
    docsHint: 'Needs a TikTok for Business app with Comment Management access.',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    externalIdHint: 'YouTube channel id (starts with UC)',
    secretLabel: 'Google OAuth access token',
    secretRequired: true,
    identityInUrl: true,
    webhookPath: '/api/webhooks/youtube',
    docsHint: 'Comments are polled every few minutes; replies post in-thread.',
  },
  // Declared in ./sms so the Twilio wording sits next to the Twilio code.
  SMS_CHANNEL_DESCRIPTOR,
  {
    key: 'email',
    label: 'Email & Gmail',
    externalIdHint: 'The inbox address customers write to',
    secretLabel: 'Not required for inbound-parse',
    secretRequired: false,
    identityInUrl: false,
    webhookPath: '/api/webhooks/email',
    docsHint: 'Forward mail here, or connect Gmail with one click for two-way replies.',
  },
];

export function getChannelDescriptor(key: string): ChannelDescriptor | null {
  return CHANNEL_DESCRIPTORS.find((d) => d.key === key) ?? null;
}
