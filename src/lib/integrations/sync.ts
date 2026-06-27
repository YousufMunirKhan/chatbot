import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { notify } from '@/lib/notify';
import { logger } from '@/lib/logger';

/**
 * Sync runner (Module 14). Store/ecommerce providers feed external data into
 * structured tables. The assistant answers product/stock/order questions from
 * these tables, never from scraped website text.
 */
interface SyncOutcome {
  records: number;
  errors: string[];
}

type Row = Record<string, unknown>;

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

function text(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function nullableText(value: unknown): string | null {
  const v = text(value).trim();
  return v || null;
}

function money(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<{ data: T | null; error?: string; headers: Headers }> {
  const res = await fetch(url, init);
  if (!res.ok) return { data: null, error: `${res.status} ${await res.text().catch(() => '')}`.trim(), headers: res.headers };
  return { data: (await res.json()) as T, headers: res.headers };
}

async function upsertByExternalId(
  table: string,
  companyId: string,
  externalId: string,
  payload: Row,
): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from(table)
    .select('id')
    .eq('company_id', companyId)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await sb
      .from(table)
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from(table)
    .insert({ company_id: companyId, external_id: externalId, ...payload })
    .select('id')
    .single();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

async function upsertInventory(params: {
  companyId: string;
  productId: string | null;
  variantId?: string | null;
  quantity: number;
  inStock?: boolean;
  location?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('synced_inventory')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('product_id', params.productId);

  query = params.variantId ? query.eq('variant_id', params.variantId) : query.is('variant_id', null);
  query = params.location ? query.eq('location', params.location) : query.is('location', null);

  const { data: existing } = await query.maybeSingle();
  const payload = {
    product_id: params.productId,
    variant_id: params.variantId ?? null,
    quantity: params.quantity,
    in_stock: params.inStock ?? params.quantity > 0,
    location: params.location ?? null,
    updated_at: new Date().toISOString(),
  };

  const result = existing?.id
    ? await sb.from('synced_inventory').update(payload).eq('company_id', params.companyId).eq('id', existing.id)
    : await sb.from('synced_inventory').insert({ company_id: params.companyId, ...payload });
  if (result.error) throw result.error;
}

async function syncWooCommerce(companyId: string, creds: Row): Promise<SyncOutcome> {
  const base = text(creds.base_url).replace(/\/$/, '');
  const key = text(creds.consumer_key);
  const secret = text(creds.consumer_secret);
  if (!base || !key || !secret) return { records: 0, errors: ['Missing WooCommerce credentials'] };

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const init = { headers: { Authorization: `Basic ${auth}` } };
  let records = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/products?per_page=${PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce products: ${error}`] };
    if (!data?.length) break;

    for (const p of data) {
      const productExternalId = text(p.id);
      const productId = await upsertByExternalId('synced_products', companyId, productExternalId, {
        title: text(p.name, 'Untitled'),
        description: text(p.short_description || p.description),
        category: Array.isArray(p.categories) ? text((p.categories[0] as Row | undefined)?.name) || null : null,
        price: money(p.price),
        currency: text(creds.currency, 'USD'),
        sku: nullableText(p.sku),
        status: text(p.status, 'active'),
        metadata_json: {
          provider: 'woocommerce',
          permalink: p.permalink ?? null,
          type: p.type ?? null,
        },
      });
      records++;

      if (productId) {
        await upsertInventory({
          companyId,
          productId,
          quantity: int(p.stock_quantity, p.stock_status === 'instock' ? 1 : 0),
          inStock: p.stock_status === 'instock',
        });
      }

      const variationRefs = Array.isArray(p.variations) ? p.variations : [];
      if (productId && (p.type === 'variable' || variationRefs.length > 0)) {
        const { data: variations } = await fetchJson<Row[]>(
          `${base}/wp-json/wc/v3/products/${productExternalId}/variations?per_page=${PAGE_SIZE}`,
          init,
        );
        for (const v of variations ?? []) {
          const variantId = await upsertByExternalId('synced_product_variants', companyId, text(v.id), {
            product_id: productId,
            title: text(v.name || v.sku || `Variant ${v.id}`),
            price: money(v.price),
            sku: nullableText(v.sku),
            options_json: {
              provider: 'woocommerce',
              attributes: v.attributes ?? [],
            },
          });
          records++;
          await upsertInventory({
            companyId,
            productId,
            variantId,
            quantity: int(v.stock_quantity, v.stock_status === 'instock' ? 1 : 0),
            inStock: v.stock_status === 'instock',
          });
        }
      }
    }
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/customers?per_page=${PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce customers: ${error}`] };
    if (!data?.length) break;
    for (const c of data) {
      await upsertByExternalId('synced_customers', companyId, text(c.id), {
        name: [c.first_name, c.last_name].map((x) => text(x)).filter(Boolean).join(' ') || nullableText(c.username),
        email: nullableText(c.email),
        phone: nullableText((c.billing as Row | undefined)?.phone),
        metadata_json: { provider: 'woocommerce' },
      });
      records++;
    }
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/orders?per_page=${PAGE_SIZE}&page=${page}&status=any`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce orders: ${error}`] };
    if (!data?.length) break;
    for (const o of data) {
      const billing = (o.billing as Row | undefined) ?? {};
      const shippingLines = Array.isArray(o.shipping_lines) ? (o.shipping_lines as Row[]) : [];
      const orderId = await upsertByExternalId('synced_orders', companyId, text(o.id), {
        order_number: nullableText(o.number),
        customer_name: [billing.first_name, billing.last_name].map((x) => text(x)).filter(Boolean).join(' ') || null,
        customer_email: nullableText(billing.email),
        customer_phone: nullableText(billing.phone),
        status: nullableText(o.status),
        fulfillment_status: nullableText(o.status),
        tracking_number: null,
        tracking_url: null,
        total: money(o.total),
        currency: text(o.currency, 'USD'),
        placed_at: nullableText(o.date_created),
        metadata_json: {
          provider: 'woocommerce',
          payment_method: o.payment_method_title ?? null,
          shipping: shippingLines,
        },
      });
      if (orderId) {
        const sb = createSupabaseServiceClient();
        await sb.from('synced_order_items').delete().eq('company_id', companyId).eq('order_id', orderId);
        const items = Array.isArray(o.line_items) ? (o.line_items as Row[]) : [];
        if (items.length) {
          const { error: itemError } = await sb.from('synced_order_items').insert(
            items.map((item) => ({
              company_id: companyId,
              order_id: orderId,
              title: nullableText(item.name),
              quantity: int(item.quantity, 1),
              price: money(item.total),
              metadata_json: { product_id: item.product_id ?? null, variation_id: item.variation_id ?? null },
            })),
          );
          if (itemError) throw itemError;
        }
      }
      records++;
    }
  }

  return { records, errors: [] };
}

async function syncShopify(companyId: string, creds: Row): Promise<SyncOutcome> {
  const shop = text(creds.shop).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = text(creds.access_token);
  const apiVersion = text(creds.api_version, '2024-01');
  if (!shop || !token) return { records: 0, errors: ['Missing Shopify credentials'] };

  const base = `https://${shop}/admin/api/${apiVersion}`;
  const init = { headers: { 'X-Shopify-Access-Token': token } };
  let records = 0;
  const inventoryItems: string[] = [];
  const variantByInventoryItem = new Map<string, { productId: string; variantId: string }>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<{ products?: Row[] }>(
      `${base}/products.json?limit=${PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`Shopify products: ${error}`] };
    const products = data?.products ?? [];
    if (!products.length) break;

    for (const p of products) {
      const variants = Array.isArray(p.variants) ? (p.variants as Row[]) : [];
      const firstVariant = variants[0] ?? {};
      const productId = await upsertByExternalId('synced_products', companyId, text(p.id), {
        title: text(p.title, 'Untitled'),
        description: text(p.body_html),
        category: nullableText(p.product_type),
        price: money(firstVariant.price),
        currency: text(creds.currency, 'USD'),
        sku: nullableText(firstVariant.sku),
        status: text(p.status, 'active'),
        metadata_json: {
          provider: 'shopify',
          vendor: p.vendor ?? null,
          handle: p.handle ?? null,
          tags: p.tags ?? null,
        },
      });
      records++;

      for (const variant of variants) {
        if (!productId) continue;
        const variantId = await upsertByExternalId('synced_product_variants', companyId, text(variant.id), {
          product_id: productId,
          title: text(variant.title, 'Default'),
          price: money(variant.price),
          sku: nullableText(variant.sku),
          options_json: {
            option1: variant.option1 ?? null,
            option2: variant.option2 ?? null,
            option3: variant.option3 ?? null,
          },
        });
        const inventoryItemId = nullableText(variant.inventory_item_id);
        if (inventoryItemId && variantId) {
          inventoryItems.push(inventoryItemId);
          variantByInventoryItem.set(inventoryItemId, { productId, variantId });
        }
        await upsertInventory({
          companyId,
          productId,
          variantId,
          quantity: int(variant.inventory_quantity, 0),
        });
        records++;
      }
    }
  }

  for (let i = 0; i < inventoryItems.length; i += 50) {
    const ids = inventoryItems.slice(i, i + 50);
    const { data } = await fetchJson<{ inventory_levels?: Row[] }>(
      `${base}/inventory_levels.json?inventory_item_ids=${ids.join(',')}`,
      init,
    );
    for (const level of data?.inventory_levels ?? []) {
      const inventoryItemId = text(level.inventory_item_id);
      const mapped = variantByInventoryItem.get(inventoryItemId);
      if (!mapped) continue;
      await upsertInventory({
        companyId,
        productId: mapped.productId,
        variantId: mapped.variantId,
        quantity: int(level.available, 0),
        location: nullableText(level.location_id),
      });
      records++;
    }
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<{ customers?: Row[] }>(
      `${base}/customers.json?limit=${PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`Shopify customers: ${error}`] };
    const customers = data?.customers ?? [];
    if (!customers.length) break;
    for (const c of customers) {
      await upsertByExternalId('synced_customers', companyId, text(c.id), {
        name: [c.first_name, c.last_name].map((x) => text(x)).filter(Boolean).join(' ') || null,
        email: nullableText(c.email),
        phone: nullableText(c.phone),
        metadata_json: { provider: 'shopify' },
      });
      records++;
    }
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await fetchJson<{ orders?: Row[] }>(
      `${base}/orders.json?status=any&limit=${PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`Shopify orders: ${error}`] };
    const orders = data?.orders ?? [];
    if (!orders.length) break;
    for (const o of orders) {
      const customer = (o.customer as Row | undefined) ?? {};
      const shippingAddress = (o.shipping_address as Row | undefined) ?? {};
      const orderId = await upsertByExternalId('synced_orders', companyId, text(o.id), {
        order_number: nullableText(o.name) ?? nullableText(o.order_number),
        customer_name:
          [customer.first_name ?? shippingAddress.first_name, customer.last_name ?? shippingAddress.last_name]
            .map((x) => text(x))
            .filter(Boolean)
            .join(' ') || null,
        customer_email: nullableText(o.email) ?? nullableText(customer.email),
        customer_phone: nullableText(o.phone) ?? nullableText(shippingAddress.phone),
        status: nullableText(o.financial_status),
        fulfillment_status: nullableText(o.fulfillment_status),
        tracking_number: null,
        tracking_url: null,
        total: money(o.total_price),
        currency: text(o.currency, 'USD'),
        placed_at: nullableText(o.created_at),
        metadata_json: {
          provider: 'shopify',
          cancelled_at: o.cancelled_at ?? null,
        },
      });
      if (orderId) {
        const sb = createSupabaseServiceClient();
        await sb.from('synced_order_items').delete().eq('company_id', companyId).eq('order_id', orderId);
        const items = Array.isArray(o.line_items) ? (o.line_items as Row[]) : [];
        if (items.length) {
          const { error: itemError } = await sb.from('synced_order_items').insert(
            items.map((item) => ({
              company_id: companyId,
              order_id: orderId,
              title: nullableText(item.title),
              quantity: int(item.quantity, 1),
              price: money(item.price),
              metadata_json: {
                product_id: item.product_id ?? null,
                variant_id: item.variant_id ?? null,
                sku: item.sku ?? null,
              },
            })),
          );
          if (itemError) throw itemError;
        }
      }
      records++;
    }
  }

  return { records, errors: [] };
}

async function syncCustomApi(companyId: string, creds: Row): Promise<SyncOutcome> {
  const base = text(creds.base_url).replace(/\/$/, '');
  const token = text(creds.token);
  if (!base) return { records: 0, errors: ['Missing base_url'] };

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let records = 0;

  const syncList = async (pathValue: unknown, rootKey: string): Promise<Row[]> => {
    const path = text(pathValue);
    if (!path) return [];
    const { data, error } = await fetchJson<unknown>(joinUrl(base, path), { headers });
    if (error) throw new Error(`${path}: ${error}`);
    if (Array.isArray(data)) return data as Row[];
    const fromRoot = (data as Row | null)?.[rootKey];
    return Array.isArray(fromRoot) ? (fromRoot as Row[]) : [];
  };

  const products = await syncList(creds.products_path ?? '/products', 'products');
  const productByExternal = new Map<string, string>();
  for (const p of products) {
    const externalId = text(p.id ?? p.external_id ?? p.sku);
    if (!externalId) continue;
    const productId = await upsertByExternalId('synced_products', companyId, externalId, {
      title: text(p.title ?? p.name, 'Untitled'),
      description: nullableText(p.description),
      category: nullableText(p.category),
      price: money(p.price),
      currency: text(p.currency, 'USD'),
      sku: nullableText(p.sku),
      status: text(p.status, 'active'),
      metadata_json: { provider: 'custom_api', raw: p },
    });
    if (productId) productByExternal.set(externalId.toLowerCase(), productId);
    records++;
  }

  const inventory = await syncList(creds.inventory_path, 'inventory');
  for (const item of inventory) {
    const productKey = text(item.product_id ?? item.external_id ?? item.sku).toLowerCase();
    const productId = productByExternal.get(productKey) ?? null;
    if (!productId) continue;
    await upsertInventory({
      companyId,
      productId,
      quantity: int(item.quantity ?? item.stock, 0),
      location: nullableText(item.location),
    });
    records++;
  }

  const customers = await syncList(creds.customers_path, 'customers');
  for (const c of customers) {
    const externalId = text(c.id ?? c.external_id ?? c.email ?? c.phone);
    if (!externalId) continue;
    await upsertByExternalId('synced_customers', companyId, externalId, {
      name: nullableText(c.name),
      email: nullableText(c.email),
      phone: nullableText(c.phone),
      metadata_json: { provider: 'custom_api', raw: c },
    });
    records++;
  }

  const orders = await syncList(creds.orders_path, 'orders');
  for (const o of orders) {
    const externalId = text(o.id ?? o.external_id ?? o.order_number);
    if (!externalId) continue;
    const orderId = await upsertByExternalId('synced_orders', companyId, externalId, {
      order_number: nullableText(o.order_number ?? o.number),
      customer_name: nullableText(o.customer_name),
      customer_email: nullableText(o.customer_email ?? o.email),
      customer_phone: nullableText(o.customer_phone ?? o.phone),
      status: nullableText(o.status),
      fulfillment_status: nullableText(o.fulfillment_status),
      tracking_number: nullableText(o.tracking_number),
      tracking_url: nullableText(o.tracking_url),
      total: money(o.total),
      currency: text(o.currency, 'USD'),
      placed_at: nullableText(o.placed_at ?? o.created_at),
      metadata_json: { provider: 'custom_api', raw: o },
    });
    const items = Array.isArray(o.items) ? (o.items as Row[]) : [];
    if (orderId && items.length) {
      const sb = createSupabaseServiceClient();
      await sb.from('synced_order_items').delete().eq('company_id', companyId).eq('order_id', orderId);
      const { error } = await sb.from('synced_order_items').insert(
        items.map((item) => ({
          company_id: companyId,
          order_id: orderId,
          title: nullableText(item.title ?? item.name),
          quantity: int(item.quantity, 1),
          price: money(item.price),
          metadata_json: item,
        })),
      );
      if (error) throw error;
    }
    records++;
  }

  return { records, errors: [] };
}

/** Run a sync for one integration account; records a sync_job + updates timestamps. */
export async function runSync(integrationAccountId: string): Promise<SyncOutcome> {
  const sb = createSupabaseServiceClient();
  const { data: account } = await sb
    .from('integration_accounts')
    .select('id, company_id, provider, credentials_encrypted')
    .eq('id', integrationAccountId)
    .maybeSingle();
  if (!account) return { records: 0, errors: ['Integration not found'] };

  const companyId = account.company_id as string;
  const provider = account.provider as string;
  const { data: job } = await sb
    .from('sync_jobs')
    .insert({
      company_id: companyId,
      integration_account_id: integrationAccountId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  let creds: Row = {};
  try {
    if (account.credentials_encrypted) creds = JSON.parse(decryptSecret(account.credentials_encrypted as string));
  } catch {
    creds = {};
  }

  let outcome: SyncOutcome = { records: 0, errors: ['Unsupported provider'] };
  try {
    if (provider === 'woocommerce') outcome = await syncWooCommerce(companyId, creds);
    else if (provider === 'shopify') outcome = await syncShopify(companyId, creds);
    else if (provider === 'custom_api') outcome = await syncCustomApi(companyId, creds);
    else outcome = { records: 0, errors: [`No automatic sync for ${provider} (use CSV import)`] };
  } catch (err) {
    outcome = { records: 0, errors: [err instanceof Error ? err.message : 'sync failed'] };
  }

  const failed = outcome.errors.length > 0;
  await sb
    .from('sync_jobs')
    .update({
      status: failed ? 'failed' : 'completed',
      records_processed: outcome.records,
      error_message: failed ? outcome.errors.join('; ') : null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job!.id);
  await sb
    .from('integration_accounts')
    .update({
      status: failed ? 'error' : 'connected',
      last_sync_at: new Date().toISOString(),
      next_sync_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .eq('id', integrationAccountId);

  if (failed) {
    logger.warn('Sync failed', { companyId, module: 'integrations' });
    await notify({ companyId, type: 'failed_sync', title: 'Integration sync failed', body: outcome.errors.join('; '), email: false });
  }
  return outcome;
}
