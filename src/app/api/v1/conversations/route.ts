import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  ApiError,
  apiData,
  paginationMeta,
  parseIsoDate,
  parsePagination,
  withApiAuth,
} from '@/lib/api/handler';
import { CONVERSATION_COLUMNS, toApiConversation } from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mirrors the `conversations_status_check` constraint (migration 0015). */
const STATUSES = ['ai_active', 'needs_human', 'human_active', 'closed', 'expired'];

/** GET /api/v1/conversations — paginated, filterable by status, channel, since. */
export const GET = withApiAuth('conversations:read', async (ctx) => {
  const pagination = parsePagination(ctx.searchParams);
  const status = ctx.searchParams.get('status');
  const channel = ctx.searchParams.get('channel');
  const since = parseIsoDate(ctx.searchParams.get('since'), 'since');

  if (status && !STATUSES.includes(status)) {
    throw new ApiError('invalid_request', `\`status\` must be one of: ${STATUSES.join(', ')}.`);
  }

  const sb = createSupabaseServiceClient();
  let query = sb
    .from('conversations')
    .select(CONVERSATION_COLUMNS, { count: 'exact' })
    // TENANT ISOLATION: the key's company, never a request value.
    .eq('company_id', ctx.companyId)
    .order('last_message_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (status) query = query.eq('status', status);
  if (channel) query = query.eq('channel', channel);
  if (since) query = query.gte('last_message_at', since);

  const { data, count, error } = await query;
  if (error) throw new ApiError('internal_error', 'Could not load conversations.');

  return apiData(
    (data ?? []).map((row) => toApiConversation(row as Record<string, unknown>)),
    paginationMeta(pagination, count),
  );
});
