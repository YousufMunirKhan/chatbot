/**
 * Channel adapter contract.
 *
 * Every messaging surface (WhatsApp, Messenger, Telegram, Viber, LINE, TikTok,
 * YouTube, Gmail, email, SMS) is reduced to two operations: parse an inbound
 * webhook into a normalised event, and deliver outbound blocks. Everything above
 * this layer — the AI engine, the flow runtime, the inbox — is channel-agnostic.
 */

export const CHANNEL_KEYS = [
  'whatsapp',
  'instagram',
  'facebook',
  'email',
  'telegram',
  'viber',
  'line',
  'tiktok',
  'youtube',
  'sms',
] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];
// The human name for each key is not repeated here: the connect screen reads it
// from CHANNEL_DESCRIPTORS in ./registry, and anything holding only a raw key
// (the inbox badge, reports) reads CHANNEL_LABELS from @/lib/constants, which
// already covers 'sms'.

/** A button/quick-reply the customer can tap. `value` is echoed back as text. */
export interface OutboundButton {
  label: string;
  /** Payload delivered back to us when tapped (ignored when `url` is set). */
  value?: string;
  /** External link — rendered as a URL button where the channel supports it. */
  url?: string;
}

export interface GalleryItem {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  buttons?: OutboundButton[];
}

/**
 * The renderable unit of an outbound reply. A flow node or an AI answer is
 * compiled to blocks; each adapter maps them onto its native message types and
 * degrades gracefully (a gallery becomes a numbered text list on Telegram-less
 * channels, buttons become "reply with 1/2/3" on plain-text transports).
 */
export type OutboundBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'video'; url: string; caption?: string }
  | { type: 'file'; url: string; name?: string }
  | { type: 'buttons'; text: string; buttons: OutboundButton[] }
  | { type: 'quick_replies'; text: string; options: OutboundButton[] }
  | { type: 'gallery'; items: GalleryItem[] };

export interface InboundAttachment {
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
  name?: string;
}

/** A normalised inbound event, whatever the provider's payload looked like. */
export interface InboundEvent {
  /** Which connected account received this (page id, bot id, inbox address). */
  externalId: string;
  /** Stable id of the person who sent it, scoped to the channel. */
  from: string;
  /** Human-readable sender name when the provider gives one. */
  fromName?: string;
  text: string;
  /** Provider message id — used to drop duplicate webhook deliveries. */
  messageId?: string;
  /** `comment` events come from a public post rather than a private thread. */
  kind: 'message' | 'comment';
  commentId?: string;
  postId?: string;
  /** Referral / entry point (ad id, ref parameter, deep link). */
  referral?: string;
  attachments?: InboundAttachment[];
  /** Short-lived token some providers require to answer (LINE replyToken). */
  replyToken?: string;
  raw?: unknown;
}

/** Everything an adapter needs to talk back to the provider. */
export interface ChannelSendContext {
  companyId: string;
  /**
   * `channel_identities.id`. Adapters whose credential expires (the Google
   * ones) need it to persist a refreshed token instead of failing an hour
   * after the channel was connected.
   */
  identityId?: string;
  channel: ChannelKey;
  /** The connected account id (page id, bot id, phone number id). */
  externalId: string;
  /** Decrypted access token / bot token / API key. */
  secret: string | null;
  settings: Record<string, unknown>;
  replyToken?: string;
}

export interface ChannelAdapter {
  key: ChannelKey;
  label: string;
  /**
   * How the connected account is identified when adding the channel — shown as
   * the field hint on the Channels screen.
   */
  externalIdHint: string;
  /** Whether the provider performs a GET hub-challenge handshake. */
  usesMetaHandshake?: boolean;
  /**
   * Some providers (Telegram, Viber) do not include the receiving account in the
   * payload. For those the webhook URL carries `?id=<externalId>`.
   */
  identityFromQuery?: boolean;
  /** Verify the payload signature. Return true when no secret is configured. */
  verifySignature?(raw: string, headers: Headers, secret: string | null): boolean;
  /** Normalise a provider payload into zero or more inbound events. */
  parse(payload: unknown, ctx: { queryIdentity: string | null; headers: Headers }): InboundEvent[];
  /** Deliver outbound blocks. Returns false when nothing could be sent. */
  send(ctx: ChannelSendContext, to: string, blocks: OutboundBlock[]): Promise<boolean>;
  /** Reply to a public comment (feed channels only). */
  replyToComment?(ctx: ChannelSendContext, commentId: string, text: string): Promise<boolean>;
  /** Send a private DM in response to a public comment (Meta feed channels). */
  privateReplyToComment?(ctx: ChannelSendContext, commentId: string, text: string): Promise<boolean>;
}

/** Flatten blocks to plain text — the universal fallback for any transport. */
export function blocksToText(blocks: OutboundBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'text':
        parts.push(b.text);
        break;
      case 'image':
      case 'video':
        parts.push([b.caption, b.url].filter(Boolean).join('\n'));
        break;
      case 'file':
        parts.push([b.name, b.url].filter(Boolean).join('\n'));
        break;
      case 'buttons':
        parts.push([b.text, ...b.buttons.map((x, i) => `${i + 1}. ${x.label}${x.url ? ` — ${x.url}` : ''}`)].join('\n'));
        break;
      case 'quick_replies':
        parts.push([b.text, ...b.options.map((x, i) => `${i + 1}. ${x.label}`)].join('\n'));
        break;
      case 'gallery':
        parts.push(
          b.items
            .map((it, i) =>
              [`${i + 1}. ${it.title}`, it.subtitle, it.imageUrl].filter(Boolean).join('\n'),
            )
            .join('\n\n'),
        );
        break;
    }
  }
  return parts.filter(Boolean).join('\n\n').trim();
}

/** Convenience for adapters that only support plain text. */
export function textBlocks(text: string): OutboundBlock[] {
  return text.trim() ? [{ type: 'text', text }] : [];
}
