import crypto from 'node:crypto';
import { postJson } from '../http';
import { blocksToText } from '../types';
import type { ChannelAdapter, InboundEvent } from '../types';

const BUSINESS_API = 'https://business-api.tiktok.com/open_api/v1.3';

interface TikTokWebhook {
  event?: string;
  client_key?: string;
  user_openid?: string;
  create_time?: number;
  /** TikTok delivers the event body as a JSON *string*. */
  content?: string | Record<string, unknown>;
}

function parseContent(content: TikTokWebhook['content']): Record<string, unknown> {
  if (!content) return {};
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * TikTok for Business.
 *
 * TikTok's conversational surface is comments on videos (Comment Management
 * API); direct messages are gated to selected partners. Comment events arrive
 * on the app-level webhook with the creator's open id, so the connected account
 * is matched on `user_openid` (stored as the channel's external id) and the
 * `?id=` query is only a fallback for the sandbox.
 */
export const tiktokAdapter: ChannelAdapter = {
  key: 'tiktok',
  label: 'TikTok',
  externalIdHint: 'Creator open id (or business id) of the connected TikTok account',
  identityFromQuery: true,

  verifySignature(raw, headers, secret) {
    // TikTok signs with the app secret using a Stripe-style "t=...,s=..." header.
    const appSecret = process.env.TIKTOK_CLIENT_SECRET || secret;
    if (!appSecret) return true;
    const header = headers.get('tiktok-signature') ?? headers.get('x-tiktok-signature');
    if (!header) return true;
    const parts = Object.fromEntries(
      header.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k?.trim() ?? '', v?.trim() ?? ''];
      }),
    );
    const timestamp = parts.t;
    const provided = parts.s;
    if (!timestamp || !provided) return false;
    const expected = crypto.createHmac('sha256', appSecret).update(`${timestamp}.${raw}`).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  },

  parse(payload, ctx): InboundEvent[] {
    const body = (payload ?? {}) as TikTokWebhook;
    const content = parseContent(body.content);
    const externalId = body.user_openid ?? ctx.queryIdentity;
    if (!externalId) return [];

    const event = body.event ?? '';
    if (!event.startsWith('comment')) return [];
    // Edits and deletes are not new conversations.
    if (event.includes('delete')) return [];

    const commentId = (content.comment_id as string) ?? (content.id as string);
    const text = String((content.text as string) ?? (content.content as string) ?? '').trim();
    if (!commentId || !text) return [];

    return [
      {
        externalId,
        from: (content.unique_id as string) ?? (content.user_id as string) ?? commentId,
        fromName: (content.nickname as string) ?? undefined,
        text,
        messageId: commentId,
        kind: 'comment',
        commentId,
        postId: (content.video_id as string) ?? (content.item_id as string) ?? undefined,
        raw: content,
      },
    ];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    // Direct messaging is not generally available; the useful outbound action is
    // replying to the comment thread the customer started.
    const text = blocksToText(blocks);
    if (!text) return false;
    return replyToTikTokComment(ctx.secret, ctx.settings, to, text);
  },

  async replyToComment(ctx, commentId, text) {
    return replyToTikTokComment(ctx.secret, ctx.settings, commentId, text);
  },
};

async function replyToTikTokComment(
  token: string | null,
  settings: Record<string, unknown>,
  commentId: string,
  text: string,
): Promise<boolean> {
  if (!token) return false;
  const businessId = settings.businessId as string | undefined;
  const res = await postJson(
    `${BUSINESS_API}/comment/reply/`,
    { comment_id: commentId, text: text.slice(0, 150), ...(businessId ? { business_id: businessId } : {}) },
    { headers: { 'Access-Token': token } },
  );
  const code = (res.body as { code?: number } | null)?.code;
  return res.ok && (code === undefined || code === 0);
}
