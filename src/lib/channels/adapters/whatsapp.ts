import { postJson } from '../http';
import { verifyHmac } from '../verify';
import type { ChannelAdapter, InboundEvent, OutboundBlock, OutboundButton } from '../types';

const GRAPH = 'https://graph.facebook.com/v19.0';

interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: Array<{
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
    image?: { link?: string; id?: string; caption?: string };
    document?: { link?: string; id?: string; filename?: string };
    referral?: { source_id?: string; source_url?: string; ctwa_clid?: string };
  }>;
  statuses?: unknown[];
}

/**
 * WhatsApp Cloud API.
 *
 * Adds interactive replies (buttons, lists, product messages) on top of the
 * plain-text send the platform already had, and parses button/list taps back
 * into ordinary inbound text so flows and the AI treat them identically.
 */
export const whatsappAdapter: ChannelAdapter = {
  key: 'whatsapp',
  label: 'WhatsApp Business',
  externalIdHint: 'Phone number id from WhatsApp Cloud API',
  usesMetaHandshake: true,

  verifySignature(raw, headers) {
    return verifyHmac({
      raw,
      signature: headers.get('x-hub-signature-256'),
      secret: process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET,
      prefix: 'sha256=',
      context: 'whatsapp webhook',
    });
  },

  parse(payload): InboundEvent[] {
    const body = (payload ?? {}) as { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> };
    const out: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        const externalId = value.metadata?.phone_number_id;
        if (!externalId) continue;
        const profileName = value.contacts?.[0]?.profile?.name;

        for (const message of value.messages ?? []) {
          const from = message.from;
          if (!from) continue;

          let text = '';
          const attachments: InboundEvent['attachments'] = [];
          if (message.type === 'text') text = (message.text?.body ?? '').trim();
          else if (message.type === 'button') text = (message.button?.payload ?? message.button?.text ?? '').trim();
          else if (message.type === 'interactive') {
            const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
            text = (reply?.id ?? reply?.title ?? '').trim();
          } else if (message.type === 'image' && message.image) {
            text = (message.image.caption ?? '').trim();
            if (message.image.link) attachments.push({ kind: 'image', url: message.image.link });
          } else if (message.type === 'document' && message.document) {
            if (message.document.link) {
              attachments.push({ kind: 'file', url: message.document.link, name: message.document.filename });
            }
          }

          const referral = message.referral?.source_id ?? message.referral?.ctwa_clid;
          if (!text && attachments.length === 0) continue;
          out.push({
            externalId,
            from,
            fromName: profileName,
            text,
            messageId: message.id,
            kind: 'message',
            referral: referral ?? undefined,
            attachments: attachments.length ? attachments : undefined,
            raw: message,
          });
        }
      }
    }
    return out;
  },

  async send(ctx, to, blocks): Promise<boolean> {
    if (!ctx.secret) return false;
    let delivered = false;
    for (const block of blocks) {
      for (const message of whatsappMessages(block)) {
        const ok = await sendWhatsAppRaw(ctx.secret, ctx.externalId, to, message);
        delivered = delivered || ok;
      }
    }
    return delivered;
  },
};

/** POST one already-shaped Cloud API message object. */
export async function sendWhatsAppRaw(
  token: string,
  phoneNumberId: string,
  to: string,
  message: Record<string, unknown>,
): Promise<boolean> {
  const res = await postJson(
    `${GRAPH}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^whatsapp:/, ''),
      ...message,
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.ok;
}

function rows(buttons: OutboundButton[]) {
  return buttons.map((b, i) => ({
    id: (b.value ?? b.label ?? String(i)).slice(0, 200),
    title: b.label.slice(0, 24),
  }));
}

/**
 * Map a block onto Cloud API message objects.
 *
 * WhatsApp caps reply buttons at 3; anything wider becomes a list message,
 * which holds 10 rows — so a long option set degrades to the richest native
 * control instead of a wall of text.
 */
export function whatsappMessages(block: OutboundBlock): Record<string, unknown>[] {
  switch (block.type) {
    case 'text':
      return [{ type: 'text', text: { preview_url: true, body: block.text.slice(0, 4000) } }];
    case 'image':
      return [{ type: 'image', image: { link: block.url, caption: block.caption?.slice(0, 1000) } }];
    case 'video':
      return [{ type: 'video', video: { link: block.url, caption: block.caption?.slice(0, 1000) } }];
    case 'file':
      return [{ type: 'document', document: { link: block.url, filename: block.name ?? 'document' } }];
    case 'buttons':
    case 'quick_replies': {
      const options = block.type === 'buttons' ? block.buttons : block.options;
      const bodyText = block.text.slice(0, 1024);
      const urlButtons = options.filter((b) => b.url);
      const tapButtons = options.filter((b) => !b.url);

      // URL buttons need a CTA message of their own; keep them as trailing text
      // so a mixed set still delivers in one predictable order.
      const extra: Record<string, unknown>[] = urlButtons.length
        ? [
            {
              type: 'text',
              text: {
                preview_url: true,
                body: urlButtons.map((b) => `${b.label}: ${b.url}`).join('\n').slice(0, 4000),
              },
            },
          ]
        : [];

      if (tapButtons.length === 0) return extra.length ? extra : [{ type: 'text', text: { body: bodyText } }];

      if (tapButtons.length <= 3) {
        return [
          {
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: bodyText },
              action: { buttons: rows(tapButtons).map((r) => ({ type: 'reply', reply: r })) },
            },
          },
          ...extra,
        ];
      }
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: bodyText },
            action: {
              button: 'Choose',
              sections: [{ title: 'Options', rows: rows(tapButtons).slice(0, 10) }],
            },
          },
        },
        ...extra,
      ];
    }
    case 'gallery':
      // No native carousel outside template messages: each card is an image with
      // its caption, which is what customers actually see in a product list.
      return block.items.slice(0, 10).map((item) => {
        const caption = [item.title, item.subtitle, ...(item.buttons ?? []).map((b) => (b.url ? `${b.label}: ${b.url}` : b.label))]
          .filter(Boolean)
          .join('\n')
          .slice(0, 1000);
        return item.imageUrl
          ? { type: 'image', image: { link: item.imageUrl, caption } }
          : { type: 'text', text: { body: caption } };
      });
    default:
      return [];
  }
}
