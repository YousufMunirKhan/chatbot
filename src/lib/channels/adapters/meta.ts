import { postJson } from '../http';
import { verifyHmac } from '../verify';
import type { ChannelAdapter, ChannelKey, InboundEvent, OutboundBlock, OutboundButton } from '../types';

const GRAPH = 'https://graph.facebook.com/v19.0';

interface MetaMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: { ref?: string; ad_id?: string } };
  referral?: { ref?: string; ad_id?: string; source?: string; type?: string };
}

interface MetaEntry {
  id?: string;
  messaging?: MetaMessaging[];
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
}

interface MetaPayload {
  object?: string;
  entry?: MetaEntry[];
}

/**
 * Meta's app secret signs every webhook body. It is a single app-level secret
 * (not per connected page), so it comes from the environment rather than from
 * the channel row.
 */
function verifyMetaSignature(raw: string, headers: Headers): boolean {
  return verifyHmac({
    raw,
    signature: headers.get('x-hub-signature-256'),
    secret: process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET,
    prefix: 'sha256=',
    context: 'meta webhook',
  });
}

type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

function attachmentsOf(message: MetaMessaging['message']): InboundEvent['attachments'] {
  const items = (message?.attachments ?? [])
    .map((a) => {
      const url = a.payload?.url;
      if (!url) return null;
      const kind: AttachmentKind =
        a.type === 'image' || a.type === 'video' || a.type === 'audio' ? a.type : 'file';
      return { kind, url };
    })
    .filter((x): x is { kind: AttachmentKind; url: string } => x !== null);
  return items.length ? items : undefined;
}

/** Shared parser for Messenger and Instagram Direct, plus their feed comments. */
function parseMeta(payload: unknown, commentField: string): InboundEvent[] {
  const body = (payload ?? {}) as MetaPayload;
  const out: InboundEvent[] = [];

  for (const entry of body.entry ?? []) {
    const externalId = entry.id;
    if (!externalId) continue;

    for (const m of entry.messaging ?? []) {
      const from = m.sender?.id;
      if (!from) continue;
      // Echoes are our own outbound messages coming back; replying to them loops.
      if (m.message?.is_echo) continue;

      const referral =
        m.referral?.ad_id ?? m.referral?.ref ?? m.postback?.referral?.ad_id ?? m.postback?.referral?.ref;

      if (m.message?.quick_reply?.payload) {
        out.push({
          externalId,
          from,
          text: m.message.quick_reply.payload,
          messageId: m.message.mid,
          kind: 'message',
          referral: referral ?? undefined,
          raw: m,
        });
        continue;
      }
      if (m.postback?.payload) {
        out.push({
          externalId,
          from,
          text: m.postback.payload,
          messageId: m.postback.mid,
          kind: 'message',
          referral: referral ?? undefined,
          raw: m,
        });
        continue;
      }
      const text = (m.message?.text ?? '').trim();
      const attachments = attachmentsOf(m.message);
      if (!text && !attachments && !referral) continue;
      out.push({
        externalId,
        from,
        text,
        messageId: m.message?.mid,
        kind: 'message',
        referral: referral ?? undefined,
        attachments,
        raw: m,
      });
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== commentField) continue;
      const value = change.value ?? {};
      // Page feed changes cover likes, shares and edits too - only new comments
      // are conversational.
      if (commentField === 'feed' && (value.item !== 'comment' || value.verb !== 'add')) continue;
      const commentId = (value.comment_id as string) ?? (value.id as string);
      const fromObj = (value.from as { id?: string; name?: string; username?: string } | undefined) ?? {};
      const text = ((value.message as string) ?? (value.text as string) ?? '').trim();
      if (!commentId || !text) continue;
      // Never answer our own page's comments.
      if (fromObj.id && fromObj.id === externalId) continue;
      const media = value.media as { id?: string } | undefined;
      out.push({
        externalId,
        from: fromObj.id ?? commentId,
        fromName: fromObj.name ?? fromObj.username,
        text,
        messageId: commentId,
        kind: 'comment',
        commentId,
        postId: (value.post_id as string) ?? media?.id,
        raw: value,
      });
    }
  }
  return out;
}

function metaButtons(buttons: OutboundButton[]) {
  return buttons.slice(0, 3).map((b) =>
    b.url
      ? { type: 'web_url', url: b.url, title: b.label.slice(0, 20) }
      : { type: 'postback', title: b.label.slice(0, 20), payload: (b.value ?? b.label).slice(0, 1000) },
  );
}

function metaMessages(block: OutboundBlock): Record<string, unknown>[] {
  switch (block.type) {
    case 'text':
      return [{ text: block.text.slice(0, 2000) }];
    case 'image':
    case 'video':
      return [{ attachment: { type: block.type, payload: { url: block.url, is_reusable: true } } }];
    case 'file':
      return [{ attachment: { type: 'file', payload: { url: block.url, is_reusable: true } } }];
    case 'quick_replies':
      return [
        {
          text: block.text.slice(0, 2000),
          quick_replies: block.options.slice(0, 13).map((o) => ({
            content_type: 'text',
            title: o.label.slice(0, 20),
            payload: (o.value ?? o.label).slice(0, 1000),
          })),
        },
      ];
    case 'buttons':
      return [
        {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: block.text.slice(0, 640),
              buttons: metaButtons(block.buttons),
            },
          },
        },
      ];
    case 'gallery':
      return [
        {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: block.items.slice(0, 10).map((item) => ({
                title: item.title.slice(0, 80),
                subtitle: item.subtitle?.slice(0, 80),
                image_url: item.imageUrl,
                buttons: item.buttons?.length ? metaButtons(item.buttons) : undefined,
              })),
            },
          },
        },
      ];
    default:
      return [];
  }
}

async function sendViaGraph(
  pageId: string,
  token: string,
  recipient: Record<string, string>,
  blocks: OutboundBlock[],
): Promise<boolean> {
  let delivered = false;
  for (const block of blocks) {
    for (const message of metaMessages(block)) {
      const res = await postJson(
        `${GRAPH}/${pageId}/messages`,
        { recipient, message, messaging_type: 'RESPONSE' },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      delivered = delivered || res.ok;
    }
  }
  return delivered;
}

function makeMetaAdapter(config: {
  key: ChannelKey;
  label: string;
  externalIdHint: string;
  commentField: string;
}): ChannelAdapter {
  return {
    key: config.key,
    label: config.label,
    externalIdHint: config.externalIdHint,
    usesMetaHandshake: true,
    verifySignature: (raw, headers) => verifyMetaSignature(raw, headers),
    parse: (payload) => parseMeta(payload, config.commentField),
    async send(ctx, to, blocks) {
      if (!ctx.secret) return false;
      return sendViaGraph(ctx.externalId, ctx.secret, { id: to }, blocks);
    },
    async replyToComment(ctx, commentId, text) {
      if (!ctx.secret) return false;
      const res = await postJson(
        `${GRAPH}/${commentId}/replies`,
        { message: text.slice(0, 2000) },
        { headers: { Authorization: `Bearer ${ctx.secret}` } },
      );
      return res.ok;
    },
    async privateReplyToComment(ctx, commentId, text) {
      if (!ctx.secret) return false;
      // Meta's private-reply entry point: address the message to the comment id
      // and the platform opens a DM thread with its author.
      return sendViaGraph(ctx.externalId, ctx.secret, { comment_id: commentId }, [{ type: 'text', text }]);
    },
  };
}

export const facebookAdapter = makeMetaAdapter({
  key: 'facebook',
  label: 'Facebook Messenger & Feed',
  externalIdHint: 'Facebook Page id',
  commentField: 'feed',
});

export const instagramAdapter = makeMetaAdapter({
  key: 'instagram',
  label: 'Instagram Direct & Feed',
  externalIdHint: 'Instagram professional account id',
  commentField: 'comments',
});
