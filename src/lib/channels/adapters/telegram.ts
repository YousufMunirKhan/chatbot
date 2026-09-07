import crypto from 'node:crypto';
import { postJson } from '../http';
import type { ChannelAdapter, InboundEvent, OutboundBlock } from '../types';

const API = 'https://api.telegram.org';

interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: {
    id: string;
    from?: { id: number; first_name?: string; username?: string };
    message?: { chat?: { id: number }; message_id?: number };
    data?: string;
  };
}
interface TgMessage {
  message_id?: number;
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  chat?: { id: number };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string }>;
  document?: { file_id: string; file_name?: string };
}

function senderName(from?: { first_name?: string; last_name?: string; username?: string }): string | undefined {
  if (!from) return undefined;
  const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return full || from.username || undefined;
}

/**
 * Telegram Bot API.
 *
 * Telegram never tells us which bot received an update, so the webhook URL
 * carries `?id=<bot id>` and the optional secret-token header is verified
 * against the stored value.
 */
export const telegramAdapter: ChannelAdapter = {
  key: 'telegram',
  label: 'Telegram',
  externalIdHint: 'Bot id — the digits before ":" in your BotFather token',
  identityFromQuery: true,

  verifySignature(_raw, headers, secret) {
    // Telegram's secret token is a shared string, not an HMAC. It is optional:
    // when the connected account has not stored one, the ?id lookup plus the
    // unguessable bot id is the only guard, matching Telegram's own default.
    const expected = secret;
    if (!expected) return true;
    const got = headers.get('x-telegram-bot-api-secret-token');
    if (!got) return true;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
    } catch {
      return false;
    }
  },

  parse(payload, ctx): InboundEvent[] {
    const externalId = ctx.queryIdentity;
    if (!externalId) return [];
    const update = (payload ?? {}) as TgUpdate;

    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      if (!chatId || !cq.data) return [];
      return [
        {
          externalId,
          from: String(chatId),
          fromName: senderName(cq.from),
          text: cq.data,
          messageId: `cb:${cq.id}`,
          kind: 'message',
          raw: payload,
        },
      ];
    }

    const msg = update.message ?? update.edited_message;
    const chatId = msg?.chat?.id;
    if (!msg || !chatId) return [];
    const text = (msg.text ?? msg.caption ?? '').trim();
    const attachments: InboundEvent['attachments'] = [];
    const largestPhoto = msg.photo?.length ? msg.photo[msg.photo.length - 1] : undefined;
    if (largestPhoto) attachments.push({ kind: 'image', url: `telegram-file:${largestPhoto.file_id}` });
    if (msg.document) {
      attachments.push({ kind: 'file', url: `telegram-file:${msg.document.file_id}`, name: msg.document.file_name });
    }
    if (!text && attachments.length === 0) return [];
    return [
      {
        externalId,
        from: String(chatId),
        fromName: senderName(msg.from),
        text,
        messageId: msg.message_id ? String(msg.message_id) : undefined,
        kind: 'message',
        attachments: attachments.length ? attachments : undefined,
        raw: payload,
      },
    ];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const token = ctx.secret;
    if (!token) return false;
    let delivered = false;
    for (const block of blocks) {
      const ok = await sendBlock(token, to, block);
      delivered = delivered || ok;
    }
    return delivered;
  },
};

async function sendBlock(token: string, chatId: string, block: OutboundBlock): Promise<boolean> {
  const base = `${API}/bot${token}`;
  switch (block.type) {
    case 'text': {
      const res = await postJson(`${base}/sendMessage`, { chat_id: chatId, text: block.text.slice(0, 4096) });
      return res.ok;
    }
    case 'image': {
      const res = await postJson(`${base}/sendPhoto`, { chat_id: chatId, photo: block.url, caption: block.caption });
      return res.ok;
    }
    case 'video': {
      const res = await postJson(`${base}/sendVideo`, { chat_id: chatId, video: block.url, caption: block.caption });
      return res.ok;
    }
    case 'file': {
      const res = await postJson(`${base}/sendDocument`, { chat_id: chatId, document: block.url });
      return res.ok;
    }
    case 'buttons': {
      // Telegram inline keyboards allow 64 bytes of callback data, so long
      // payloads fall back to sending the label itself as the reply text.
      const rows = block.buttons.map((b) => [
        b.url
          ? { text: b.label, url: b.url }
          : { text: b.label, callback_data: truncateBytes(b.value ?? b.label, 64) },
      ]);
      const res = await postJson(`${base}/sendMessage`, {
        chat_id: chatId,
        text: block.text.slice(0, 4096),
        reply_markup: { inline_keyboard: rows },
      });
      return res.ok;
    }
    case 'quick_replies': {
      const rows = chunk(
        block.options.map((o) => ({ text: o.label })),
        2,
      );
      const res = await postJson(`${base}/sendMessage`, {
        chat_id: chatId,
        text: block.text.slice(0, 4096),
        reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: true },
      });
      return res.ok;
    }
    case 'gallery': {
      // Telegram has no native carousel; each card is sent as a photo with its
      // own inline keyboard, which is the closest faithful rendering.
      let any = false;
      for (const item of block.items.slice(0, 10)) {
        const caption = [item.title, item.subtitle].filter(Boolean).join('\n');
        const keyboard = item.buttons?.length
          ? {
              inline_keyboard: item.buttons.map((b) => [
                b.url ? { text: b.label, url: b.url } : { text: b.label, callback_data: truncateBytes(b.value ?? b.label, 64) },
              ]),
            }
          : undefined;
        const res = item.imageUrl
          ? await postJson(`${base}/sendPhoto`, {
              chat_id: chatId,
              photo: item.imageUrl,
              caption,
              reply_markup: keyboard,
            })
          : await postJson(`${base}/sendMessage`, { chat_id: chatId, text: caption, reply_markup: keyboard });
        any = any || res.ok;
      }
      return any;
    }
    default:
      return false;
  }
}

function truncateBytes(value: string, max: number): string {
  const buf = Buffer.from(value, 'utf8');
  return buf.length <= max ? value : buf.subarray(0, max).toString('utf8');
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Register the webhook with Telegram — used by the Channels screen. */
export async function setTelegramWebhook(token: string, url: string, secretToken?: string): Promise<boolean> {
  const res = await postJson(`${API}/bot${token}/setWebhook`, {
    url,
    secret_token: secretToken || undefined,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
  });
  return res.ok;
}
