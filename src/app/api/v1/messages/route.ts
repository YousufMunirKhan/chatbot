import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import { deliverApiMessage } from '@/lib/api/delivery';
import { dispatchDeveloperEvent } from '@/lib/api/developer-events';
import { MESSAGE_COLUMNS, toApiMessage } from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mirrors `conversations_channel_check` (migration 0052). */
const CONVERSATION_CHANNELS = [
  'web_chat',
  'voice',
  'whatsapp',
  'instagram',
  'facebook',
  'email',
  'phone',
  'api',
  'telegram',
  'viber',
  'line',
  'tiktok',
  'youtube',
] as const;

const bodySchema = z
  .object({
    conversation_id: z.string().uuid().optional(),
    channel: z.enum(CONVERSATION_CHANNELS).optional(),
    /** Channel-scoped recipient id: phone number, page-scoped id, email address. */
    to: z.string().min(1).max(320).optional(),
    text: z.string().min(1, 'text is required').max(4000),
  })
  .refine((v) => Boolean(v.conversation_id) || Boolean(v.channel && v.to), {
    message: 'Provide `conversation_id`, or `channel` + `to` to start a conversation.',
  });

/**
 * POST /api/v1/messages
 *
 * Sends a message into an existing conversation, or starts one on a channel.
 * The row is written first and delivery reported separately: an integration
 * must be able to see what was said even when the provider rejected the send.
 */
export const POST = withApiAuth('conversations:write', async (ctx) => {
  const body = bodySchema.parse(await ctx.json());
  const sb = createSupabaseServiceClient();

  let conversationId = body.conversation_id ?? null;
  // Widened to `string`: an existing conversation's channel comes from the
  // database, which is not narrowed to the zod enum.
  let channel: string = body.channel ?? 'api';
  let recipient = body.to ?? null;

  if (conversationId) {
    // TENANT ISOLATION: only a conversation owned by the key's company.
    const { data } = await sb
      .from('conversations')
      .select('id,channel,visitor_id')
      .eq('company_id', ctx.companyId)
      .eq('id', conversationId)
      .maybeSingle();
    if (!data) throw new ApiError('not_found', 'Conversation not found.');
    const row = data as { channel: string; visitor_id: string | null };
    channel = body.channel ?? row.channel;
    recipient = body.to ?? row.visitor_id;
  } else {
    const { data, error } = await sb
      .from('conversations')
      .insert({
        company_id: ctx.companyId,
        channel,
        // AI stays on so a reply to this message is still answered automatically;
        // pause it from the inbox (or send further messages) to take over.
        status: 'ai_active',
        ai_enabled: true,
        visitor_id: recipient,
        state_json: { source: 'public_api', api_key_id: ctx.apiKeyId },
      })
      .select('id')
      .single();
    if (error || !data) throw new ApiError('internal_error', 'Could not start the conversation.');
    conversationId = (data as { id: string }).id;
  }

  const { data: message, error: insertError } = await sb
    .from('messages')
    .insert({
      company_id: ctx.companyId,
      conversation_id: conversationId,
      channel,
      sender_type: 'agent',
      sender_id: `api_key:${ctx.apiKeyId}`,
      content_text: body.text,
      metadata_json: { source: 'public_api' },
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (insertError || !message) throw new ApiError('internal_error', 'Could not store the message.');

  await sb
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('company_id', ctx.companyId)
    .eq('id', conversationId);

  const delivery = recipient
    ? await deliverApiMessage({ companyId: ctx.companyId, channel, to: recipient, text: body.text })
    : {
        delivered: false as const,
        transport: 'channel' as const,
        reason: 'No recipient: pass `to`, or use a conversation that has a visitor id.',
      };

  await dispatchDeveloperEvent({
    companyId: ctx.companyId,
    event: 'message.sent',
    title: 'Message sent via API',
    body: body.text.slice(0, 200),
    data: { conversation_id: conversationId, channel, delivered: delivery.delivered },
  });

  return apiData(
    {
      ...toApiMessage(message as Record<string, unknown>),
      delivery: {
        delivered: delivery.delivered,
        transport: delivery.transport,
        reason: delivery.reason ?? null,
      },
    },
    undefined,
    201,
  );
});
