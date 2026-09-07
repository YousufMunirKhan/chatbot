import crypto from 'node:crypto';
import { postJson } from '../http';
import { blocksToText } from '../types';
import type { ChannelAdapter, InboundEvent, OutboundBlock, OutboundButton } from '../types';

const API = 'https://chatapi.viber.com/pa';

interface ViberPayload {
  event?: string;
  message_token?: number;
  sender?: { id?: string; name?: string };
  user?: { id?: string; name?: string };
  message?: { type?: string; text?: string; media?: string; file_name?: string };
  context?: string;
}

/**
 * Viber Public Account / bot API.
 *
 * Viber signs every callback with an HMAC of the raw body keyed by the bot's
 * auth token, and the payload does not name the receiving account, so the
 * webhook URL carries `?id=<account id>`.
 */
export const viberAdapter: ChannelAdapter = {
  key: 'viber',
  label: 'Viber',
  externalIdHint: 'Public Account id (any stable label you also use in the webhook URL)',
  identityFromQuery: true,

  verifySignature(raw, headers, secret) {
    if (!secret) return true;
    const signature = headers.get('x-viber-content-signature');
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  },

  parse(payload, ctx): InboundEvent[] {
    const externalId = ctx.queryIdentity;
    if (!externalId) return [];
    const body = (payload ?? {}) as ViberPayload;
    if (body.event !== 'message') return [];
    const sender = body.sender ?? body.user;
    const from = sender?.id;
    const text = (body.message?.text ?? '').trim();
    const media = body.message?.media;
    if (!from || (!text && !media)) return [];
    return [
      {
        externalId,
        from,
        fromName: sender?.name,
        text,
        messageId: body.message_token ? String(body.message_token) : undefined,
        kind: 'message',
        referral: body.context || undefined,
        attachments: media
          ? [{ kind: body.message?.type === 'picture' ? 'image' : 'file', url: media, name: body.message?.file_name }]
          : undefined,
        raw: payload,
      },
    ];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const token = ctx.secret;
    if (!token) return false;
    const senderName = (ctx.settings.senderName as string) || 'Assistant';
    let delivered = false;
    for (const block of blocks) {
      const messages = viberMessages(block, senderName, to);
      for (const message of messages) {
        const res = await postJson(`${API}/send_message`, message, { headers: { 'X-Viber-Auth-Token': token } });
        // Viber answers 200 with {status: 0} on success and a non-zero status
        // code inside the body on failure, so HTTP 200 alone is not enough.
        const status = (res.body as { status?: number } | null)?.status;
        delivered = delivered || (res.ok && (status === undefined || status === 0));
      }
    }
    return delivered;
  },
};

function keyboard(buttons: OutboundButton[]) {
  return {
    Type: 'keyboard',
    DefaultHeight: false,
    Buttons: buttons.slice(0, 24).map((b) => ({
      Columns: 6,
      Rows: 1,
      ActionType: b.url ? 'open-url' : 'reply',
      ActionBody: b.url ?? b.value ?? b.label,
      Text: b.label,
    })),
  };
}

function viberMessages(block: OutboundBlock, senderName: string, receiver: string): Record<string, unknown>[] {
  const sender = { name: senderName };
  switch (block.type) {
    case 'text':
      return [{ receiver, sender, type: 'text', text: block.text.slice(0, 7000) }];
    case 'image':
      return [{ receiver, sender, type: 'picture', text: block.caption ?? '', media: block.url }];
    case 'video':
      return [{ receiver, sender, type: 'video', media: block.url, size: 0 }];
    case 'file':
      return [{ receiver, sender, type: 'file', media: block.url, file_name: block.name ?? 'file' }];
    case 'buttons':
      return [{ receiver, sender, type: 'text', text: block.text.slice(0, 7000), keyboard: keyboard(block.buttons) }];
    case 'quick_replies':
      return [{ receiver, sender, type: 'text', text: block.text.slice(0, 7000), keyboard: keyboard(block.options) }];
    case 'gallery':
      // Viber rich media needs a fixed 6-column grid; one card per message with
      // its own keyboard keeps the layout predictable across clients.
      return block.items.slice(0, 10).map((item) => ({
        receiver,
        sender,
        type: item.imageUrl ? 'picture' : 'text',
        ...(item.imageUrl
          ? { media: item.imageUrl, text: [item.title, item.subtitle].filter(Boolean).join(' — ') }
          : { text: [item.title, item.subtitle].filter(Boolean).join('\n') }),
        ...(item.buttons?.length ? { keyboard: keyboard(item.buttons) } : {}),
      }));
    default:
      return [{ receiver, sender, type: 'text', text: blocksToText([block]) }];
  }
}

/** Point Viber at our webhook. Viber requires this call to register a bot. */
export async function setViberWebhook(token: string, url: string): Promise<boolean> {
  const res = await postJson(
    `${API}/set_webhook`,
    { url, event_types: ['message', 'subscribed', 'unsubscribed', 'delivered', 'seen'], send_name: true },
    { headers: { 'X-Viber-Auth-Token': token } },
  );
  const status = (res.body as { status?: number } | null)?.status;
  return res.ok && (status === undefined || status === 0);
}
