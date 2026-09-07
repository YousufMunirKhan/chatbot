import { createSupabaseServiceClient } from '@/lib/db/server';
import { ApiError, apiData, parseIsoDate, withApiAuth } from '@/lib/api/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;

type Sb = ReturnType<typeof createSupabaseServiceClient>;

/** Row count for one table in the window, scoped to the key's company. */
async function countRows(
  sb: Sb,
  table: string,
  companyId: string,
  column: string,
  from: string,
  to: string,
  extra?: { column: string; value: string },
): Promise<number> {
  let query = sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte(column, from)
    .lte(column, to);
  if (extra) query = query.eq(extra.column, extra.value);
  const { count } = await query;
  return count ?? 0;
}

/**
 * GET /api/v1/analytics/summary?from=&to=
 *
 * Counts for a date range. Defaults to the last 30 days; the window is capped
 * so a single call cannot ask the database to scan a decade.
 */
export const GET = withApiAuth('analytics:read', async (ctx) => {
  const now = new Date();
  const to = parseIsoDate(ctx.searchParams.get('to'), 'to') ?? now.toISOString();
  const from =
    parseIsoDate(ctx.searchParams.get('from'), 'from') ??
    new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();

  const spanMs = new Date(to).getTime() - new Date(from).getTime();
  if (spanMs < 0) throw new ApiError('invalid_request', '`from` must be before `to`.');
  if (spanMs > MAX_WINDOW_DAYS * 86_400_000) {
    throw new ApiError('invalid_request', `The range cannot exceed ${MAX_WINDOW_DAYS} days.`);
  }

  const sb = createSupabaseServiceClient();
  const id = ctx.companyId;
  const [
    conversations,
    conversationsClosed,
    messages,
    visitorMessages,
    aiMessages,
    agentMessages,
    leads,
    appointments,
    chatOrders,
  ] = await Promise.all([
    countRows(sb, 'conversations', id, 'started_at', from, to),
    countRows(sb, 'conversations', id, 'closed_at', from, to),
    countRows(sb, 'messages', id, 'created_at', from, to),
    countRows(sb, 'messages', id, 'created_at', from, to, { column: 'sender_type', value: 'visitor' }),
    countRows(sb, 'messages', id, 'created_at', from, to, { column: 'sender_type', value: 'ai' }),
    countRows(sb, 'messages', id, 'created_at', from, to, { column: 'sender_type', value: 'agent' }),
    countRows(sb, 'leads', id, 'created_at', from, to),
    countRows(sb, 'appointments', id, 'created_at', from, to),
    countRows(sb, 'chat_orders', id, 'created_at', from, to),
  ]);

  return apiData({
    range: { from, to },
    conversations: { started: conversations, closed: conversationsClosed },
    messages: {
      total: messages,
      visitor: visitorMessages,
      ai: aiMessages,
      agent: agentMessages,
    },
    leads,
    appointments,
    orders: chatOrders,
  });
});
