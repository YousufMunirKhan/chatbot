import { createSupabaseServiceClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { queueAutomations } from '@/lib/commerce/automations';
import {
  deriveOrderEvent,
  isCheckoutTopic,
  mapStoreTopic,
  type AutomationEntity,
  type AutomationEvent,
  type StoreProvider,
} from '@/lib/commerce/automation-templates';
import { STORE_SIGNATURE_HEADERS, verifyStoreSignature } from '@/lib/commerce/store-signatures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store webhooks (Shopify + WooCommerce).
 *
 * The payload never says which of our tenants it belongs to, so the URL does:
 * `/api/webhooks/store/shopify?t=<integration_accounts.webhook_token>`. The
 * token is unique platform-wide, so it can only ever resolve to one company.
 * A shop-domain lookup is kept as a fallback for stores registered before a
 * token existed.
 *
 * Verification is HMAC-SHA256/base64 of the RAW body for both providers, keyed
 * by SHOPIFY_WEBHOOK_SECRET / WOOCOMMERCE_WEBHOOK_SECRET.
 */

type Row = Record<string, unknown>;

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function providerSecret(provider: StoreProvider): string | null {
  const e = serverEnv();
  return (provider === 'shopify' ? e.SHOPIFY_WEBHOOK_SECRET : e.WOOCOMMERCE_WEBHOOK_SECRET) ?? null;
}

/** `mystore.myshopify.com` / `https://shop.com/` → a comparable host. */
function hostOf(value: unknown): string {
  return text(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

async function resolveCompany(
  provider: StoreProvider,
  token: string | null,
  shopDomain: string,
): Promise<string | null> {
  const sb = createSupabaseServiceClient();

  if (token) {
    const { data } = await sb
      .from('integration_accounts')
      .select('company_id')
      .eq('webhook_token', token)
      .maybeSingle();
    const companyId = (data as { company_id?: string } | null)?.company_id ?? null;
    if (companyId) return companyId;
  }

  if (!shopDomain) return null;
  // Fallback: match the shop host recorded in the account's settings. Only the
  // non-secret settings are searched — credentials stay encrypted at rest.
  const { data } = await sb
    .from('integration_accounts')
    .select('company_id,settings_json')
    .eq('provider', provider)
    .limit(500);
  for (const row of (data ?? []) as Array<{ company_id: string; settings_json: Row | null }>) {
    const s = row.settings_json ?? {};
    const candidates = [s.shop, s.shop_domain, s.domain, s.base_url, s.store_url].map(hostOf).filter(Boolean);
    if (candidates.includes(shopDomain)) return row.company_id;
  }
  return null;
}

/** Upsert into the existing synced_orders table, scoped to the company. */
async function upsertOrder(companyId: string, externalId: string, payload: Row): Promise<string | null> {
  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from('synced_orders')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await sb
      .from('synced_orders')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', existing.id as string)
      .select('id')
      .single();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  }

  const { data, error } = await sb
    .from('synced_orders')
    .insert({ company_id: companyId, external_id: externalId, ...payload })
    .select('id')
    .single();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

async function replaceOrderItems(companyId: string, orderId: string, items: Row[]): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('synced_order_items').delete().eq('company_id', companyId).eq('order_id', orderId);
  if (!items.length) return;
  await sb.from('synced_order_items').insert(
    items.map((item) => ({
      company_id: companyId,
      order_id: orderId,
      title: nullableText(item.title ?? item.name),
      quantity: Number(item.quantity ?? 1) || 1,
      price: money(item.price ?? item.total),
      metadata_json: { product_id: item.product_id ?? null },
    })),
  );
}

interface NormalisedOrder {
  externalId: string;
  row: Row;
  items: Row[];
  status: string | null;
  fulfillment: string | null;
  entity: Omit<AutomationEntity, 'id'>;
}

function normaliseShopifyOrder(body: Row): NormalisedOrder | null {
  const externalId = text(body.id);
  if (!externalId) return null;
  const customer = (body.customer as Row | undefined) ?? {};
  const shipping = (body.shipping_address as Row | undefined) ?? {};
  const fulfillments = Array.isArray(body.fulfillments) ? (body.fulfillments as Row[]) : [];
  const lastFulfillment = fulfillments[fulfillments.length - 1] ?? {};
  const trackingUrl =
    nullableText(lastFulfillment.tracking_url) ??
    (Array.isArray(lastFulfillment.tracking_urls) ? nullableText((lastFulfillment.tracking_urls as unknown[])[0]) : null);
  const trackingNumber = nullableText(lastFulfillment.tracking_number);

  const name =
    [customer.first_name ?? shipping.first_name, customer.last_name ?? shipping.last_name]
      .map((x) => text(x))
      .filter(Boolean)
      .join(' ') || null;
  const status = nullableText(body.cancelled_at) ? 'cancelled' : nullableText(body.financial_status);
  const fulfillment = nullableText(body.fulfillment_status);
  const items = Array.isArray(body.line_items) ? (body.line_items as Row[]) : [];

  return {
    externalId,
    status,
    fulfillment,
    items,
    row: {
      order_number: nullableText(body.name) ?? nullableText(body.order_number),
      customer_name: name,
      customer_email: nullableText(body.email) ?? nullableText(customer.email),
      customer_phone: nullableText(body.phone) ?? nullableText(customer.phone) ?? nullableText(shipping.phone),
      status,
      fulfillment_status: fulfillment,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      total: money(body.total_price),
      currency: text(body.currency, 'USD'),
      placed_at: nullableText(body.created_at),
      metadata_json: { provider: 'shopify', source: 'webhook', cancelled_at: body.cancelled_at ?? null },
    },
    entity: {
      type: 'order',
      orderNumber: nullableText(body.name) ?? nullableText(body.order_number),
      customerName: name,
      customerEmail: nullableText(body.email) ?? nullableText(customer.email),
      customerPhone: nullableText(body.phone) ?? nullableText(customer.phone) ?? nullableText(shipping.phone),
      total: money(body.total_price),
      currency: text(body.currency, 'USD'),
      status,
      trackingNumber,
      trackingUrl,
      items: items.map((i) => ({ title: nullableText(i.title), quantity: Number(i.quantity ?? 1) || 1, price: money(i.price) })),
      updatedAt: nullableText(body.updated_at),
    },
  };
}

function normaliseWooOrder(body: Row): NormalisedOrder | null {
  const externalId = text(body.id);
  if (!externalId) return null;
  const billing = (body.billing as Row | undefined) ?? {};
  const name =
    [billing.first_name, billing.last_name].map((x) => text(x)).filter(Boolean).join(' ') || null;
  const status = nullableText(body.status);
  const items = Array.isArray(body.line_items) ? (body.line_items as Row[]) : [];
  const meta = Array.isArray(body.meta_data) ? (body.meta_data as Row[]) : [];
  const trackingNumber =
    nullableText(meta.find((m) => text(m.key).includes('tracking_number'))?.value) ?? null;
  const trackingUrl = nullableText(meta.find((m) => text(m.key).includes('tracking_url'))?.value) ?? null;

  return {
    externalId,
    status,
    // Woo has no separate fulfillment field — "completed" is its shipped state.
    fulfillment: status === 'completed' ? 'completed' : null,
    items,
    row: {
      order_number: nullableText(body.number) ?? externalId,
      customer_name: name,
      customer_email: nullableText(billing.email),
      customer_phone: nullableText(billing.phone),
      status,
      fulfillment_status: status,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      total: money(body.total),
      currency: text(body.currency, 'USD'),
      placed_at: nullableText(body.date_created),
      metadata_json: { provider: 'woocommerce', source: 'webhook', payment_method: body.payment_method_title ?? null },
    },
    entity: {
      type: 'order',
      orderNumber: nullableText(body.number) ?? externalId,
      customerName: name,
      customerEmail: nullableText(billing.email),
      customerPhone: nullableText(billing.phone),
      total: money(body.total),
      currency: text(body.currency, 'USD'),
      status,
      trackingNumber,
      trackingUrl,
      items: items.map((i) => ({ title: nullableText(i.name), quantity: Number(i.quantity ?? 1) || 1, price: money(i.total) })),
      updatedAt: nullableText(body.date_modified),
    },
  };
}

/**
 * A Shopify checkout is a cart, not an abandonment. Store it (or refresh its
 * timestamp) and let `detectAbandonedCarts` decide, once it has been quiet for
 * the company's threshold.
 */
async function upsertCheckoutCart(companyId: string, body: Row): Promise<'stored' | 'skipped'> {
  const externalId = text(body.id ?? body.token);
  if (!externalId) return 'skipped';
  const sb = createSupabaseServiceClient();
  const customer = (body.customer as Row | undefined) ?? {};
  const shipping = (body.shipping_address as Row | undefined) ?? {};
  const subtotal = money(body.total_price ?? body.subtotal_price) ?? 0;
  const items = Array.isArray(body.line_items) ? (body.line_items as Row[]) : [];

  const metadata = {
    provider: 'shopify',
    source: 'checkout_webhook',
    customer_name:
      [customer.first_name ?? shipping.first_name, customer.last_name ?? shipping.last_name]
        .map((x) => text(x))
        .filter(Boolean)
        .join(' ') || null,
    customer_email: nullableText(body.email) ?? nullableText(customer.email),
    customer_phone: nullableText(body.phone) ?? nullableText(shipping.phone),
    recovery_url: nullableText(body.abandoned_checkout_url),
  };
  const touched = nullableText(body.updated_at) ?? new Date().toISOString();

  const { data: existing } = await sb
    .from('chat_carts')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_id', externalId)
    .maybeSingle();

  const patch = {
    status: 'open',
    currency: text(body.currency, 'USD'),
    subtotal,
    metadata_json: metadata,
    updated_at: touched,
  };

  if (existing?.id) {
    // A fresh checkout update means the shopper came back — clear the claim so
    // the detector can chase it again after the next quiet period.
    await sb
      .from('chat_carts')
      .update({ ...patch, abandoned_at: null })
      .eq('company_id', companyId)
      .eq('id', existing.id as string);
    return 'stored';
  }

  const { data: created } = await sb
    .from('chat_carts')
    .insert({ company_id: companyId, external_id: externalId, ...patch })
    .select('id')
    .single();

  const cartId = (created as { id?: string } | null)?.id;
  if (cartId && items.length) {
    await sb.from('chat_cart_items').insert(
      items.map((i) => ({
        company_id: companyId,
        cart_id: cartId,
        title: text(i.title ?? i.name, 'Item'),
        quantity: Number(i.quantity ?? 1) || 1,
        unit_price: money(i.price) ?? 0,
        line_total: (money(i.price) ?? 0) * (Number(i.quantity ?? 1) || 1),
      })),
    );
  }
  return 'stored';
}

async function upsertCustomer(companyId: string, body: Row): Promise<AutomationEntity | null> {
  const externalId = text(body.id);
  if (!externalId) return null;
  const sb = createSupabaseServiceClient();
  const billing = (body.billing as Row | undefined) ?? {};
  const name =
    [body.first_name ?? billing.first_name, body.last_name ?? billing.last_name]
      .map((x) => text(x))
      .filter(Boolean)
      .join(' ') || null;
  const email = nullableText(body.email) ?? nullableText(billing.email);
  const phone = nullableText(body.phone) ?? nullableText(billing.phone);

  const { data: existing } = await sb
    .from('synced_customers')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_id', externalId)
    .maybeSingle();

  const payload = { name, email, phone, metadata_json: { source: 'webhook' } };
  if (existing?.id) {
    await sb.from('synced_customers').update(payload).eq('company_id', companyId).eq('id', existing.id as string);
  } else {
    await sb.from('synced_customers').insert({ company_id: companyId, external_id: externalId, ...payload });
  }

  return {
    id: externalId,
    type: 'customer',
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
    status: 'created',
  };
}

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const provider = params.provider as StoreProvider;
  if (provider !== 'shopify' && provider !== 'woocommerce') {
    return json({ error: 'unknown_provider' }, 404);
  }

  const raw = await req.text();
  const secret = providerSecret(provider);
  const signature = req.headers.get(STORE_SIGNATURE_HEADERS[provider]);

  if (secret) {
    if (!verifyStoreSignature(raw, signature, secret)) {
      logger.warn('Store webhook signature rejected', { provider });
      return json({ error: 'bad_signature' }, 401);
    }
  } else if (serverEnv().APP_ENV === 'production') {
    // Never accept unsigned commerce data in production.
    return json({ error: 'webhook_secret_not_configured' }, 503);
  } else {
    logger.warn('Store webhook accepted without signature verification (secret not set)', { provider });
  }

  const url = new URL(req.url);
  const shopDomain = hostOf(
    req.headers.get('x-shopify-shop-domain') ?? req.headers.get('x-wc-webhook-source') ?? '',
  );
  const companyId = await resolveCompany(provider, url.searchParams.get('t'), shopDomain);
  if (!companyId) return json({ error: 'unknown_store' }, 404);

  const topic = req.headers.get(provider === 'shopify' ? 'x-shopify-topic' : 'x-wc-webhook-topic') ?? '';
  let body: Row;
  try {
    body = JSON.parse(raw) as Row;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  try {
    // Checkouts become carts; the abandonment detector queues the message.
    if (isCheckoutTopic(provider, topic)) {
      const outcome = await upsertCheckoutCart(companyId, body);
      return json({ ok: true, topic, cart: outcome });
    }

    if (topic.toLowerCase().startsWith('customer')) {
      const entity = await upsertCustomer(companyId, body);
      if (!entity) return json({ ok: true, topic, skipped: 'no_customer_id' });
      const queued = await queueAutomations(companyId, 'customer_created', entity);
      return json({ ok: true, topic, event: 'customer_created', ...queued });
    }

    const normalised = provider === 'shopify' ? normaliseShopifyOrder(body) : normaliseWooOrder(body);
    if (!normalised) return json({ ok: true, topic, skipped: 'unhandled_payload' });

    const orderId = await upsertOrder(companyId, normalised.externalId, normalised.row);
    if (orderId) await replaceOrderItems(companyId, orderId, normalised.items);

    // A fixed topic wins; "updated" topics derive their event from the status.
    const event: AutomationEvent | null =
      mapStoreTopic(provider, topic) ?? deriveOrderEvent(normalised.status, normalised.fulfillment);
    if (!event) return json({ ok: true, topic, order: orderId, event: null });

    const queued = await queueAutomations(companyId, event, {
      ...normalised.entity,
      id: normalised.externalId,
    });
    return json({ ok: true, topic, event, order: orderId, ...queued });
  } catch (err) {
    logger.error('Store webhook failed', {
      provider,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    // 200 on our own failure: a provider retry would hit the same bug and
    // eventually disable the webhook. The error is logged for us instead.
    return json({ ok: false, error: 'processing_failed' });
  }
}
