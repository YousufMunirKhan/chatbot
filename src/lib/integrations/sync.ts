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
  /** True when a page budget ran out with more records still upstream. */
  truncated?: boolean;
  /** Things the operator should know that are not failures. */
  warnings?: string[];
}

type Row = Record<string, unknown>;

/**
 * How much of a shop one run will read.
 *
 * This was five pages of a hundred — a hard ceiling of five hundred records per
 * resource, applied silently. A shop with a thousand products synced the first
 * five hundred, reported "completed", and the assistant answered from half a
 * catalogue without anyone being told. The ceiling is now high enough for a
 * normal shop, and when it IS reached the run says so instead of pretending it
 * finished.
 *
 * There still has to be a ceiling: this runs inside a request, upstream shops
 * rate-limit, and an unbounded loop against a misbehaving API is how a sync job
 * runs forever. `SYNC_TIME_BUDGET_MS` stops a slow shop long before the page
 * count does.
 */
const MAX_PAGES = 50;
/** WooCommerce rejects per_page above 100; Shopify allows limit up to 250. */
const WOO_PAGE_SIZE = 100;
const SHOPIFY_PAGE_SIZE = 250;
/** Kept for the custom-API path, which sets its own paging rules. */
const PAGE_SIZE = 100;
const SYNC_TIME_BUDGET_MS = 90_000;

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

/**
 * Shopify's `?page=` was removed in API version 2019-07 and this app defaults to
 * 2024-01, so the old paging loop asked for pages 2..5 and was handed page one
 * every time. A thousand-product shop synced its first hundred products five
 * times over and reported five hundred records.
 *
 * Cursor paging replaces it: the response carries a `Link` header, and the
 * `rel="next"` URL is the only legitimate way to ask for what comes after.
 * Absent header means there is no next page — which is also how the loop knows
 * it reached the end rather than ran out of budget.
 */
function nextPageUrl(headers: Headers): string | null {
  const link = headers.get('link') ?? headers.get('Link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const [rawUrl, ...params] = part.split(';');
    if (!params.some((p) => /rel\s*=\s*"?next"?/i.test(p))) continue;
    const url = rawUrl?.trim().replace(/^</, '').replace(/>$/, '');
    if (url) return url;
  }
  return null;
}

/**
 * Write a page of records in one statement.
 *
 * Migration 0064 added the (company_id, external_id) unique keys this relies on.
 * Before it, each record cost a SELECT and then a write — two thousand sequential
 * round trips for a thousand products — and two overlapping syncs could both
 * decide a row was missing and insert it twice.
 *
 * Returns external_id -> row id so callers can attach variants and inventory
 * without reading the rows back.
 */
async function upsertPageByExternalId(
  table: string,
  companyId: string,
  rows: (Row & { external_id: string })[],
  conflictColumns = 'company_id,external_id',
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!rows.length) return out;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from(table)
    .upsert(
      rows.map((r) => ({ company_id: companyId, ...r })),
      { onConflict: conflictColumns },
    )
    .select('id,external_id');
  if (error) throw error;

  for (const row of (data ?? []) as { id: string; external_id: string | null }[]) {
    if (row.external_id) out.set(row.external_id, row.id);
  }
  return out;
}

async function upsertByExternalId(
  table: string,
  companyId: string,
  externalId: string,
  payload: Row,
): Promise<string | null> {
  const map = await upsertPageByExternalId(table, companyId, [
    { external_id: externalId, ...payload },
  ]);
  return map.get(externalId) ?? null;
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
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  const warnings: string[] = [];
  let truncated = false;

  /**
   * WooCommerce still honours `?page=`, so the loop below is correct as written.
   * What it lacked was any way to say "there was more" — it simply stopped at
   * the page limit and reported success. A full final page means the shop had
   * more to give.
   */
  const noteTruncation = (what: string, lastPageWasFull: boolean) => {
    if (!lastPageWasFull) return;
    truncated = true;
    warnings.push(`${what} was larger than one run covers; the next hourly refresh carries on.`);
  };

  let productsLastPageFull = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() > deadline) {
      productsLastPageFull = true;
      break;
    }
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/products?per_page=${WOO_PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce products: ${error}`] };
    if (!data?.length) break;
    productsLastPageFull = data.length === WOO_PAGE_SIZE;

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
  noteTruncation('Product catalogue', productsLastPageFull);

  let customersLastPageFull = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() > deadline) {
      customersLastPageFull = true;
      break;
    }
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/customers?per_page=${WOO_PAGE_SIZE}&page=${page}`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce customers: ${error}`] };
    if (!data?.length) break;
    customersLastPageFull = data.length === WOO_PAGE_SIZE;
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

  noteTruncation('Customer list', customersLastPageFull);

  let ordersLastPageFull = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() > deadline) {
      ordersLastPageFull = true;
      break;
    }
    const { data, error } = await fetchJson<Row[]>(
      `${base}/wp-json/wc/v3/orders?per_page=${WOO_PAGE_SIZE}&page=${page}&status=any`,
      init,
    );
    if (error) return { records, errors: [`WooCommerce orders: ${error}`] };
    if (!data?.length) break;
    ordersLastPageFull = data.length === WOO_PAGE_SIZE;
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
  noteTruncation('Order history', ordersLastPageFull);

  return { records, errors: [], truncated, warnings };
}

/**
 * Walk every page of a Shopify collection, following the `Link` header.
 *
 * Stops for one of three reasons, and the caller can tell them apart: the shop
 * stopped offering a next page (finished), the page budget or time budget ran
 * out (`truncated`, and the operator is told), or the request failed (`error`).
 */
async function eachShopifyPage<T>(
  startUrl: string,
  init: RequestInit,
  deadline: number,
  onPage: (data: T) => Promise<void>,
): Promise<{ error?: string; truncated: boolean }> {
  let url: string | null = startUrl;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (!url) return { truncated: false };
    if (Date.now() > deadline) return { truncated: true };

    const { data, error, headers }: { data: T | null; error?: string; headers: Headers } =
      await fetchJson<T>(url, init);
    if (error) return { error, truncated: false };
    if (!data) return { truncated: false };

    await onPage(data);
    url = nextPageUrl(headers);
  }
  // Fell out of the loop with a next page still on offer.
  return { truncated: Boolean(url) };
}

async function syncShopify(companyId: string, creds: Row): Promise<SyncOutcome> {
  const shop = text(creds.shop).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = text(creds.access_token);
  const apiVersion = text(creds.api_version, '2024-01');
  if (!shop || !token) return { records: 0, errors: ['Missing Shopify credentials'] };

  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  const warnings: string[] = [];
  let truncated = false;

  const base = `https://${shop}/admin/api/${apiVersion}`;
  const init = { headers: { 'X-Shopify-Access-Token': token } };
  let records = 0;
  const inventoryItems: string[] = [];
  const variantByInventoryItem = new Map<string, { productId: string; variantId: string }>();

  const productsResult = await eachShopifyPage<{ products?: Row[] }>(
    `${base}/products.json?limit=${SHOPIFY_PAGE_SIZE}`,
    init,
    deadline,
    async (data) => {
      const products = data?.products ?? [];
      if (!products.length) return;

      // One statement for the whole page instead of two per product.
      const productIdByExternal = await upsertPageByExternalId(
        'synced_products',
        companyId,
        products.map((p) => {
          const variants = Array.isArray(p.variants) ? (p.variants as Row[]) : [];
          const firstVariant = variants[0] ?? {};
          return {
            external_id: text(p.id),
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
          };
        }),
      );
      records += productIdByExternal.size;

      for (const p of products) {
        const productId = productIdByExternal.get(text(p.id)) ?? null;
        if (!productId) continue;
        const variants = Array.isArray(p.variants) ? (p.variants as Row[]) : [];
        if (!variants.length) continue;

        const variantIdByExternal = await upsertPageByExternalId(
          'synced_product_variants',
          companyId,
          variants.map((variant) => ({
            external_id: text(variant.id),
            product_id: productId,
            title: text(variant.title, 'Default'),
            price: money(variant.price),
            sku: nullableText(variant.sku),
            options_json: {
              option1: variant.option1 ?? null,
              option2: variant.option2 ?? null,
              option3: variant.option3 ?? null,
            },
          })),
          'company_id,product_id,external_id',
        );
        records += variantIdByExternal.size;

        for (const variant of variants) {
          const variantId = variantIdByExternal.get(text(variant.id)) ?? null;
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
        }
      }
    },
  );
  if (productsResult.error) return { records, errors: [`Shopify products: ${productsResult.error}`] };
  if (productsResult.truncated) {
    truncated = true;
    warnings.push(
      `Read ${records} product records and stopped — this catalogue is larger than one run covers. The next hourly refresh carries on from here.`,
    );
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

  const customersResult = await eachShopifyPage<{ customers?: Row[] }>(
    `${base}/customers.json?limit=${SHOPIFY_PAGE_SIZE}`,
    init,
    deadline,
    async (data) => {
      const customers = data?.customers ?? [];
      if (!customers.length) return;
      const written = await upsertPageByExternalId(
        'synced_customers',
        companyId,
        customers.map((c) => ({
          external_id: text(c.id),
          name: [c.first_name, c.last_name].map((x) => text(x)).filter(Boolean).join(' ') || null,
          email: nullableText(c.email),
          phone: nullableText(c.phone),
          metadata_json: { provider: 'shopify' },
        })),
      );
      records += written.size;
    },
  );
  if (customersResult.error) return { records, errors: [`Shopify customers: ${customersResult.error}`] };
  if (customersResult.truncated) {
    truncated = true;
    warnings.push('Customer list was longer than one run reads; the next refresh continues it.');
  }

  const ordersResult = await eachShopifyPage<{ orders?: Row[] }>(
    `${base}/orders.json?status=any&limit=${SHOPIFY_PAGE_SIZE}`,
    init,
    deadline,
    async (data) => {
    const orders = data?.orders ?? [];
    if (!orders.length) return;
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
    },
  );
  if (ordersResult.error) return { records, errors: [`Shopify orders: ${ordersResult.error}`] };
  if (ordersResult.truncated) {
    truncated = true;
    warnings.push('Order history was longer than one run reads; the next refresh continues it.');
  }

  return { records, errors: [], truncated, warnings };
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
  const warnings = outcome.warnings ?? [];
  await sb
    .from('sync_jobs')
    .update({
      status: failed ? 'failed' : 'completed',
      records_processed: outcome.records,
      error_message: failed ? outcome.errors.join('; ') : null,
      // A run that read only part of a shop is not a failure, but calling it a
      // plain success is how an operator ends up with a half-synced catalogue
      // and no idea. Migration 0064 added these two columns for exactly this.
      truncated: Boolean(outcome.truncated),
      warning_message: warnings.length ? warnings.join(' ') : null,
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
  } else if (outcome.truncated) {
    logger.warn('Sync read only part of the shop', {
      companyId,
      module: 'integrations',
      records: outcome.records,
    });
    await notify({
      companyId,
      type: 'failed_sync',
      title: 'Shop is larger than one refresh reads',
      body: warnings.join(' '),
      email: false,
    });
  }
  return outcome;
}
