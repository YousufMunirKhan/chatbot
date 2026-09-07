import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import {
  CONVERSATION_COLUMNS,
  MESSAGE_COLUMNS,
  toApiConversation,
  toApiMessage,
} from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Transcripts can be long; cap the inline messages and document the cap. */
const MAX_MESSAGES = 200;

const idSchema = z.string().uuid('Conversation id must be a UUID.');

/** GET /api/v1/conversations/:id — the conversation plus its messages. */
export const GET = withApiAuth('conversations:read', async (ctx) => {
  const id = idSchema.parse(ctx.params.id);
  const sb = createSupabaseServiceClient();

  const { data: conversation, error } = await sb
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    // TENANT ISOLATION: company filter first — a valid id from another tenant
    // must be indistinguishable from an id that does not exist.
    .eq('company_id', ctx.companyId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError('internal_error', 'Could not load the conversation.');
  if (!conversation) throw new ApiError('not_found', 'Conversation not found.');

  const { data: messages } = await sb
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('company_id', ctx.companyId)
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES);

  return apiData({
    ...toApiConversation(conversation as Record<string, unknown>),
    messages: (messages ?? []).map((row) => toApiMessage(row as Record<string, unknown>)),
  });
});
