import { createSupabaseServiceClient } from '@/lib/db/server';
import { processInboundMessage } from '@/lib/ai/inbound';
import { logger } from '@/lib/logger';
import { resolveChannelIdentity } from './identity';
import { handleOptKeyword, setOptIn } from './subscriptions';
import { getChannelAdapter } from './registry';
import { textBlocks } from './types';
import type { ChannelAdapter, ChannelSendContext, InboundEvent, OutboundBlock } from './types';

export interface HandleResult {
  handled: number;
  skipped: number;
}

/**
 * Drop a webhook delivery we have already processed.
 *
 * The unique index does the work: a duplicate insert fails, which is the signal
 * that this exact provider message id has been seen. Events without an id (rare,
 * and never from a retrying provider) always pass through.
 */
async function claimEvent(channel: string, event: InboundEvent): Promise<boolean> {
  if (!event.messageId) return true;
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('channel_inbound_events').insert({
    channel,
    external_id: event.externalId,
    message_id: event.messageId,
  });
  if (!error) return true;
  // 23505 = unique_violation → already handled.
  if ((error as { code?: string }).code === '23505') return false;
  logger.warn('Inbound dedupe insert failed; processing anyway', { channel, error: error.message });
  return true;
}

/**
 * Record a public comment and report whether this process should answer it.
 * Uniqueness lives in the database so two concurrent webhook deliveries cannot
 * both post a public reply.
 */
async function claimComment(params: {
  companyId: string;
  channel: string;
  externalId: string;
  event: InboundEvent;
}): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('channel_comment_events').insert({
    company_id: params.companyId,
    channel: params.channel,
    external_id: params.externalId,
    comment_id: params.event.commentId ?? params.event.messageId ?? '',
    post_id: params.event.postId ?? null,
    author_id: params.event.from,
    text: params.event.text.slice(0, 2000),
  });
  if (!error) return true;
  if ((error as { code?: string }).code === '23505') return false;
  logger.warn('Comment dedupe insert failed; processing anyway', { channel: params.channel, error: error.message });
  return true;
}

async function markCommentReplied(
  channel: string,
  commentId: string,
  replyKind: 'public' | 'private',
  conversationId: string | null,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('channel_comment_events')
    .update({ replied: true, reply_kind: replyKind, conversation_id: conversationId })
    .eq('channel', channel)
    .eq('comment_id', commentId);
}

/**
 * Answer one normalised inbound event: resolve the tenant, run the shared AI /
 * flow pipeline, and deliver the reply back over the same channel.
 */
export async function handleInboundEvent(channel: string, event: InboundEvent): Promise<boolean> {
  const adapter = getChannelAdapter(channel);
  if (!adapter) return false;

  const resolved = await resolveChannelIdentity(channel, event.externalId);
  if (!resolved || !resolved.bot) {
    logger.warn('Inbound for an unconnected channel account', { channel, externalId: event.externalId });
    return false;
  }
  const { identity, bot } = resolved;

  if (!(await claimEvent(channel, event))) return false;

  const sendCtx: ChannelSendContext = {
    companyId: identity.companyId,
    channel: adapter.key,
    externalId: identity.externalId,
    secret: identity.secret,
    settings: { ...identity.settings, ...(event.kind === 'comment' ? { commentId: event.commentId } : {}) },
    replyToken: event.replyToken,
  };

  if (event.kind === 'comment') {
    const fresh = await claimComment({
      companyId: identity.companyId,
      channel,
      externalId: identity.externalId,
      event,
    });
    if (!fresh) return false;
    return handleComment(adapter, sendCtx, identity.companyId, event, bot);
  }

  // STOP / START must be honoured on the message it arrives in, before the AI
  // ever sees it — answering an unsubscribe with a sales reply is exactly what
  // gets a business number blocked. Applies to every channel, not just WhatsApp.
  const optAction = handleOptKeyword(event.text);
  if (optAction) {
    await setOptIn(identity.companyId, channel, event.from, optAction === 'opt_in', 'keyword');
    const confirmation =
      optAction === 'opt_out'
        ? 'You have been unsubscribed and will not receive further marketing messages. Reply START to opt back in.'
        : 'You are subscribed again and will receive our updates. Reply STOP at any time to unsubscribe.';
    return adapter.send(sendCtx, event.from, textBlocks(confirmation));
  }

  const result = await processInboundMessage({
    bot,
    visitorId: event.from,
    text: event.text || '(attachment)',
    channel,
    contactName: event.fromName,
    referral: event.referral,
  });

  const blocks: OutboundBlock[] = result.blocks?.length ? result.blocks : textBlocks(result.answer ?? '');
  if (blocks.length === 0) return true; // human owns the thread, or nothing to say
  return adapter.send(sendCtx, event.from, blocks);
}

/**
 * Public comments get a short public acknowledgement plus, where the platform
 * allows it, a private DM carrying the real answer. That is the pattern every
 * social team uses: keep the public thread tidy, help in private.
 */
async function handleComment(
  adapter: ChannelAdapter,
  sendCtx: ChannelSendContext,
  companyId: string,
  event: InboundEvent,
  bot: Parameters<typeof processInboundMessage>[0]['bot'],
): Promise<boolean> {
  const commentId = event.commentId ?? event.messageId;
  if (!commentId) return false;

  const settings = sendCtx.settings as { commentReply?: string; commentAck?: string };
  const mode = settings.commentReply ?? 'private_with_ack';
  if (mode === 'off') return false;

  const result = await processInboundMessage({
    bot,
    visitorId: event.from,
    text: event.text,
    channel: adapter.key,
    contactName: event.fromName,
    referral: event.postId ? `post:${event.postId}` : undefined,
  });
  const answer = (result.answer ?? '').trim();

  let delivered = false;
  let kind: 'public' | 'private' = 'public';

  if (mode === 'public' || mode === 'public_only') {
    if (answer && adapter.replyToComment) {
      delivered = await adapter.replyToComment(sendCtx, commentId, answer);
    }
  } else {
    // private_with_ack (default): DM the answer, then acknowledge publicly.
    if (answer && adapter.privateReplyToComment) {
      delivered = await adapter.privateReplyToComment(sendCtx, commentId, answer);
      kind = 'private';
    }
    if (!delivered && answer && adapter.replyToComment) {
      delivered = await adapter.replyToComment(sendCtx, commentId, answer);
      kind = 'public';
    } else if (delivered && adapter.replyToComment) {
      const ack = settings.commentAck ?? 'Thanks for reaching out — we just sent you a direct message.';
      await adapter.replyToComment(sendCtx, commentId, ack);
    }
  }

  await markCommentReplied(adapter.key, commentId, kind, result.conversationId);
  void companyId;
  return delivered;
}

/** Fan a parsed webhook payload out to the per-event handler. */
export async function handleInboundEvents(channel: string, events: InboundEvent[]): Promise<HandleResult> {
  let handled = 0;
  let skipped = 0;
  for (const event of events) {
    try {
      const ok = await handleInboundEvent(channel, event);
      if (ok) handled += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      logger.error('Inbound channel event failed', {
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { handled, skipped };
}
