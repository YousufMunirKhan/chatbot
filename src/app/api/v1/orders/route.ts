import {
  ApiError,
  apiData,
  paginationMeta,
  parseIsoDate,
  parsePagination,
  withApiAuth,
} from '@/lib/api/handler';
import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  CHAT_ORDER_COLUMNS,
  SYNCED_ORDER_COLUMNS,
  toApiChatOrder,
  toApiSyncedOrder,
} from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/orders
 *
 * The product has two order tables: `chat_orders` (placed in conversation) and
 * `synced_orders` (mirrored from Shopify/Woo/etc). They are different shapes, so
 * `?source=` selects one — defaulting to `chat`, the orders this platform owns.
 * Paginating a UNION of two tables would make `total` a lie, which is worse than
 * asking for one word in the query string.
 */
export const GET = withApiAuth('orders:read', async (ctx) => {
  const pagination = parsePagination(ctx.searchParams);
  const source = ctx.searchParams.get('source') ?? 'chat';
  const status = ctx.searchParams.get('status');
  const since = parseIsoDate(ctx.searchParams.get('since'), 'since');

  if (source !== 'chat' && source !== 'synced') {
    throw new ApiError('invalid_request', '`source` must be `chat` or `synced`.');
  }

  const sb = createSupabaseServiceClient();
  const table = source === 'chat' ? 'chat_orders' : 'synced_orders';
  const columns = source === 'chat' ? CHAT_ORDER_COLUMNS : SYNCED_ORDER_COLUMNS;

  let query = sb
    .from(table)
    .select(columns, { count: 'exact' })
    // TENANT ISOLATION: the key's company, never a request value.
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (status) query = query.eq('status', status);
  if (since) query = query.gte('created_at', since);

  const { data, count, error } = await query;
  if (error) throw new ApiError('internal_error', 'Could not load orders.');

  // The column list is chosen at runtime, so PostgREST's compile-time select
  // parser cannot infer the row shape — the serializers own it instead.
  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
    source === 'chat' ? toApiChatOrder(row) : toApiSyncedOrder(row),
  );
  return apiData(rows, paginationMeta(pagination, count));
});
