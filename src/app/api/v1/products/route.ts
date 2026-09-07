import {
  ApiError,
  apiData,
  paginationMeta,
  parsePagination,
  withApiAuth,
} from '@/lib/api/handler';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { PRODUCT_COLUMNS, toApiProduct } from '@/lib/api/serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/products — the catalogue the assistant quotes from
 * (`synced_products`), filterable by category, status and a text query.
 */
export const GET = withApiAuth('products:read', async (ctx) => {
  const pagination = parsePagination(ctx.searchParams);
  const category = ctx.searchParams.get('category');
  const status = ctx.searchParams.get('status');
  const q = ctx.searchParams.get('q');

  const sb = createSupabaseServiceClient();
  let query = sb
    .from('synced_products')
    .select(PRODUCT_COLUMNS, { count: 'exact' })
    // TENANT ISOLATION: the key's company, never a request value.
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false })
    .range(pagination.from, pagination.to);

  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);
  if (q) {
    const safe = q.replace(/[,()*]/g, ' ').trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,sku.ilike.%${safe}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new ApiError('internal_error', 'Could not load products.');

  return apiData(
    (data ?? []).map((row) => toApiProduct(row as Record<string, unknown>)),
    paginationMeta(pagination, count),
  );
});
