import crypto from 'node:crypto';
import { postJson } from '../http';
import type { ChannelAdapter, InboundEvent, OutboundBlock, OutboundButton } from '../types';

const API = 'https://api.line.me/v2/bot';

interface LinePayload {
  destination?: string;
  events?: Array<{
    type?: string;
    replyToken?: string;
    source?: { userId?: string; type?: string };
    message?: { id?: string; type?: string; text?: string };
    postback?: { data?: string };
    webhookEventId?: string;
  }>;
}

/**
 * LINE Messaging API.
 *
 * The payload carries `destination` (the bot's own user id), which is the
 * connected-account key, so no query identity is needed. Signatures are a
 * base64 HMAC-SHA256 of the raw body keyed by the channel secret.
 */
export const lineAdapter: ChannelAdapter = {
  key: 'line',
  label: 'LINE',
  externalIdHint: 'Bot user id (the "destination" value LINE sends, starts with U)',

  verifySignature(raw, headers, secret) {
    if (!secret) return true;
    const signature = headers.get('x-line-signature');
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  },

  parse(payload, ctx): InboundEvent[] {
    const body = (payload ?? {}) as LinePayload;
    const externalId = body.destination ?? ctx.queryIdentity;
    if (!externalId) return [];
    const out: InboundEvent[] = [];
    for (const event of body.events ?? []) {
      const from = event.source?.userId;
      if (!from) continue;
      if (event.type === 'message' && event.message?.type === 'text' && event.message.text) {
        out.push({
          externalId,
          from,
          text: event.message.text.trim(),
          messageId: event.message.id,
          kind: 'message',
          replyToken: event.replyToken,
          raw: event,
        });
      } else if (event.type === 'postback' && event.postback?.data) {
        out.push({
          externalId,
          from,
          text: event.postback.data,
          messageId: event.webhookEventId,
          kind: 'message',
          replyToken: event.replyToken,
          raw: event,
        });
      }
    }
    return out;
  },

  async send(ctx, to, blocks): Promise<boolean> {
    // The channel secret verifies inbound signatures; sending needs the separate
    // long-lived channel access token, stored alongside it in settings.
    const token = (ctx.settings.accessToken as string) || ctx.secret;
    if (!token) return false;
    const messages = blocks.flatMap(lineMessages).slice(0, 5);
    if (messages.length === 0) return false;
    const headers = { Authorization: `Bearer ${token}` };

    // Replying inside the token window is free; push messages are billed. Use
    // the reply token when we still hold one and fall back to push otherwise.
    if (ctx.replyToken) {
      const res = await postJson(`${API}/message/reply`, { replyToken: ctx.replyToken, messages }, { headers });
      if (res.ok) return true;
    }
    const res = await postJson(`${API}/message/push`, { to, messages }, { headers });
    return res.ok;
  },
};

function actions(buttons: OutboundButton[]) {
  return buttons.slice(0, 4).map((b) =>
    b.url
      ? { type: 'uri', label: b.label.slice(0, 20), uri: b.url }
      : { type: 'postback', label: b.label.slice(0, 20), data: (b.value ?? b.label).slice(0, 300), displayText: b.label },
  );
}

function lineMessages(block: OutboundBlock): Record<string, unknown>[] {
  switch (block.type) {
    case 'text':
      return [{ type: 'text', text: block.text.slice(0, 5000) }];
    case 'image':
      return [{ type: 'image', originalContentUrl: block.url, previewImageUrl: block.url }];
    case 'video':
      return [{ type: 'video', originalContentUrl: block.url, previewImageUrl: block.url }];
    case 'file':
      return [{ type: 'text', text: [block.name, block.url].filter(Boolean).join('\n') }];
    case 'buttons':
      return [
        {
          type: 'template',
          altText: block.text.slice(0, 400),
          template: { type: 'buttons', text: block.text.slice(0, 160), actions: actions(block.buttons) },
        },
      ];
    case 'quick_replies':
      return [
        {
          type: 'text',
          text: block.text.slice(0, 5000),
          quickReply: {
            items: block.options.slice(0, 13).map((o) => ({
              type: 'action',
              action: { type: 'message', label: o.label.slice(0, 20), text: o.value ?? o.label },
            })),
          },
        },
      ];
    case 'gallery':
      return [
        {
          type: 'template',
          altText: block.items[0]?.title?.slice(0, 400) ?? 'Options',
          template: {
            type: 'carousel',
            columns: block.items.slice(0, 10).map((item) => ({
              ...(item.imageUrl ? { thumbnailImageUrl: item.imageUrl } : {}),
              title: item.title.slice(0, 40),
              text: (item.subtitle || item.title).slice(0, 60),
              // LINE rejects carousel columns with zero actions.
              actions: item.buttons?.length
                ? actions(item.buttons)
                : [{ type: 'postback', label: 'Select', data: item.title.slice(0, 300), displayText: item.title }],
            })),
          },
        },
      ];
    default:
      return [];
  }
}
