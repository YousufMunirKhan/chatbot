import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';

export type ManagedPlatform = 'shopify' | 'square' | 'foodics';

export interface ManagedActionDef {
  name: string;
  description: string;
  actionType: 'read' | 'report';
  risk: 'low';
  requiredFields: string[];
  optionalFields: string[];
}

/** The read/report actions each managed platform exposes to the bot. */
export const MANAGED_ACTION_DEFS: Record<ManagedPlatform, ManagedActionDef[]> = {
  shopify: [
    { name: 'search_product', description: 'Search products by name.', actionType: 'read', risk: 'low', requiredFields: ['query'], optionalFields: [] },
    { name: 'get_product', description: 'Return one product by id.', actionType: 'read', risk: 'low', requiredFields: ['product_id'], optionalFields: [] },
    { name: 'check_stock', description: 'Return current stock for a product.', actionType: 'read', risk: 'low', requiredFields: ['product_id'], optionalFields: [] },
    { name: 'low_stock_products', description: 'List products at or below a stock threshold.', actionType: 'report', risk: 'low', requiredFields: [], optionalFields: ['threshold'] },
  ],
  square: [
    { name: 'search_product', description: 'Search catalog items by keyword.', actionType: 'read', risk: 'low', requiredFields: ['query'], optionalFields: [] },
    { name: 'get_product', description: 'Return one catalog object by id.', actionType: 'read', risk: 'low', requiredFields: ['product_id'], optionalFields: [] },
    { name: 'check_stock', description: 'Return inventory count for a variation id.', actionType: 'read', risk: 'low', requiredFields: ['product_id'], optionalFields: [] },
  ],
  foodics: [
    { name: 'search_product', description: 'Search products by name.', actionType: 'read', risk: 'low', requiredFields: ['query'], optionalFields: [] },
    { name: 'get_product', description: 'Return one product by id.', actionType: 'read', risk: 'low', requiredFields: ['product_id'], optionalFields: [] },
    { name: 'daily_sales_report', description: 'Return sales summary for a date.', actionType: 'report', risk: 'low', requiredFields: ['date'], optionalFields: ['branch_id'] },
  ],
};

export const MANAGED_CREDENTIAL_FIELDS: Record<ManagedPlatform, Array<{ key: string; label: string; required: boolean }>> = {
  shopify: [
    { key: 'store', label: 'Store domain (your-store.myshopify.com)', required: true },
    { key: 'token', label: 'Admin API access token', required: true },
  ],
  square: [
    { key: 'token', label: 'Square access token', required: true },
    { key: 'env', label: 'Environment (production / sandbox)', required: false },
  ],
  foodics: [{ key: 'token', label: 'Foodics API token', required: true }],
};

type Creds = Record<string, string>;
type Handler = (input: Record<string, unknown>, creds: Creds) => Promise<Record<string, unknown>>;

async function shopifyApi(creds: Creds, path: string) {
  const version = creds.apiVersion || '2024-01';
  const res = await fetch(`https://${creds.store}/admin/api/${version}${path}`, {
    headers: { 'X-Shopify-Access-Token': creds.token!, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function squareApi(creds: Creds, path: string, body?: unknown) {
  const base = creds.env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json', 'Square-Version': '2024-01-18' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Square ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function foodicsApi(creds: Creds, path: string) {
  const base = (creds.baseUrl || 'https://api.foodics.com').replace(/\/+$/, '');
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Foodics ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

const HANDLERS: Record<ManagedPlatform, Record<string, Handler>> = {
  shopify: {
    async search_product(input, creds) {
      const data = await shopifyApi(creds, `/products.json?title=${encodeURIComponent(String(input.query ?? ''))}&limit=10`);
      const products = (data.products as Array<Record<string, unknown>>) ?? [];
      return {
        results: products.map((p) => {
          const variants = (p.variants as Array<Record<string, unknown>>) ?? [];
          return { product_id: String(p.id), name: p.title, sku: variants[0]?.sku ?? null, price: variants[0]?.price ?? null };
        }),
      };
    },
    async get_product(input, creds) {
      const data = await shopifyApi(creds, `/products/${encodeURIComponent(String(input.product_id))}.json`);
      const p = data.product as Record<string, unknown> | undefined;
      return p ? { product_id: String(p.id), name: p.title } : { error: 'not_found' };
    },
    async check_stock(input, creds) {
      const data = await shopifyApi(creds, `/products/${encodeURIComponent(String(input.product_id))}.json`);
      const variants = ((data.product as Record<string, unknown>)?.variants as Array<Record<string, unknown>>) ?? [];
      const quantity = variants.reduce((sum, v) => sum + Number(v.inventory_quantity ?? 0), 0);
      return { product_id: String(input.product_id), quantity, in_stock: quantity > 0 };
    },
    async low_stock_products(input, creds) {
      const threshold = Number(input.threshold ?? 5);
      const data = await shopifyApi(creds, `/products.json?limit=50`);
      const products = (data.products as Array<Record<string, unknown>>) ?? [];
      return {
        threshold,
        products: products
          .map((p) => ({ name: p.title, qty: ((p.variants as Array<Record<string, unknown>>)?.[0]?.inventory_quantity as number) ?? 0 }))
          .filter((p) => p.qty <= threshold),
      };
    },
  },
  square: {
    async search_product(input, creds) {
      const data = await squareApi(creds, '/v2/catalog/search', {
        object_types: ['ITEM'],
        query: { text_query: { keywords: [String(input.query ?? '')] } },
        limit: 10,
      });
      const objects = (data.objects as Array<Record<string, unknown>>) ?? [];
      return { results: objects.map((o) => ({ product_id: o.id, name: (o.item_data as Record<string, unknown>)?.name })) };
    },
    async get_product(input, creds) {
      const data = await squareApi(creds, `/v2/catalog/object/${encodeURIComponent(String(input.product_id))}`);
      const o = data.object as Record<string, unknown> | undefined;
      return o ? { product_id: o.id, name: (o.item_data as Record<string, unknown>)?.name } : { error: 'not_found' };
    },
    async check_stock(input, creds) {
      const data = await squareApi(creds, '/v2/inventory/counts/batch-retrieve', { catalog_object_ids: [String(input.product_id)] });
      const counts = (data.counts as Array<Record<string, unknown>>) ?? [];
      const quantity = counts.reduce((sum, c) => sum + Number(c.quantity ?? 0), 0);
      return { product_id: String(input.product_id), quantity, in_stock: quantity > 0 };
    },
  },
  foodics: {
    async search_product(input, creds) {
      const data = await foodicsApi(creds, `/v5/products?filter[name]=${encodeURIComponent(String(input.query ?? ''))}`);
      const rows = (data.data as Array<Record<string, unknown>>) ?? [];
      return { results: rows.map((p) => ({ product_id: p.id, name: p.name, sku: p.sku ?? null, price: p.price ?? null })) };
    },
    async get_product(input, creds) {
      const data = await foodicsApi(creds, `/v5/products/${encodeURIComponent(String(input.product_id))}`);
      const p = data.data as Record<string, unknown> | undefined;
      return p ? { product_id: p.id, name: p.name, price: p.price } : { error: 'not_found' };
    },
    async daily_sales_report(input, creds) {
      const params = new URLSearchParams();
      if (input.date) params.set('filter[business_date]', String(input.date));
      if (input.branch_id) params.set('filter[branch_id]', String(input.branch_id));
      const data = await foodicsApi(creds, `/v5/orders?${params.toString()}`);
      const orders = (data.data as Array<Record<string, unknown>>) ?? [];
      const total = orders.reduce((sum, o) => sum + Number(o.total_price ?? 0), 0);
      return { date: input.date ?? null, order_count: orders.length, total_sales: total };
    },
  },
};

/**
 * If the connector is a managed (cloud) connector, execute the action directly
 * against the platform API and write the result onto the queued event — so the
 * runtime's normal wait-for-result returns it. Returns true when handled.
 */
export async function executeManagedEvent(params: {
  companyId: string;
  connectorId: string;
  eventId: string;
  eventName: string;
  input: Record<string, unknown>;
}): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('managed_connectors')
    .select('platform,credentials_encrypted,status')
    .eq('company_id', params.companyId)
    .eq('connector_id', params.connectorId)
    .maybeSingle();
  if (!data || (data as { status?: string }).status !== 'active') return false;

  const platform = (data as { platform: ManagedPlatform }).platform;
  const handler = HANDLERS[platform]?.[params.eventName];

  const finish = async (status: 'completed' | 'failed', response: unknown, error: string | null) => {
    await sb
      .from('helpdesk_connector_events')
      .update({ status, response_json: response ?? null, error_message: error, completed_at: new Date().toISOString() })
      .eq('company_id', params.companyId)
      .eq('id', params.eventId);
  };

  if (!handler) {
    await finish('failed', null, `Managed ${platform} connector does not implement ${params.eventName}.`);
    return true;
  }

  try {
    const creds = JSON.parse(decryptSecret((data as { credentials_encrypted: string }).credentials_encrypted)) as Creds;
    const response = await handler(params.input, creds);
    await finish('completed', response, null);
  } catch (err) {
    logger.error('Managed connector execution failed', {
      platform,
      action: params.eventName,
      error: err instanceof Error ? err.message : String(err),
    });
    await finish('failed', null, err instanceof Error ? err.message : 'Managed execution failed');
  }
  return true;
}
