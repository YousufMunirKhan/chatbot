/**
 * Pre-built Shopify connector (turnkey).
 *
 * Maps the standard Help Desk actions to the Shopify Admin REST API so an
 * internal assistant can answer product/stock/sales questions against a live
 * Shopify store — no custom integration code required.
 *
 * Required env:
 *   HELPDESK_BASE_URL          e.g. https://app.yourdomain.com
 *   HELPDESK_CONNECTOR_TOKEN   hdk_… token from the Help Desk dashboard
 *   SHOPIFY_STORE              your-store.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN        Admin API access token (read_products, read_inventory)
 *
 * Run:  node connectors/prebuilt/shopify/connector.mjs
 */
import { HelpdeskConnectorClient, standardActionLibrary } from '../../web/HelpdeskConnectorClient.js';

const {
  HELPDESK_BASE_URL,
  HELPDESK_CONNECTOR_TOKEN,
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_TOKEN,
  SHOPIFY_API_VERSION = '2024-01',
} = process.env;

for (const [k, v] of Object.entries({ HELPDESK_BASE_URL, HELPDESK_CONNECTOR_TOKEN, SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN })) {
  if (!v) {
    console.error(`Missing required env: ${k}`);
    process.exit(1);
  }
}

const api = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`;

async function shopify(path) {
  const res = await fetch(api + path, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  return res.json();
}

// Map the platform's data to the small, minimal result shapes the bot expects.
const handlers = {
  async search_product({ query }) {
    const data = await shopify(`/products.json?title=${encodeURIComponent(query || '')}&limit=10`);
    return {
      results: (data.products || []).map((p) => ({
        product_id: String(p.id),
        name: p.title,
        sku: p.variants?.[0]?.sku || null,
        price: p.variants?.[0]?.price || null,
        status: p.status,
      })),
    };
  },

  async get_product({ product_id }) {
    const data = await shopify(`/products/${encodeURIComponent(product_id)}.json`);
    const p = data.product;
    return p
      ? { product_id: String(p.id), name: p.title, variants: (p.variants || []).map((v) => ({ sku: v.sku, price: v.price })) }
      : { error: 'not_found' };
  },

  async check_stock({ product_id }) {
    const data = await shopify(`/products/${encodeURIComponent(product_id)}.json`);
    const variants = data.product?.variants || [];
    const itemIds = variants.map((v) => v.inventory_item_id).filter(Boolean);
    if (!itemIds.length) return { in_stock: false, quantity: 0 };
    const levels = await shopify(`/inventory_levels.json?inventory_item_ids=${itemIds.join(',')}`);
    const quantity = (levels.inventory_levels || []).reduce((sum, l) => sum + (l.available || 0), 0);
    return { product_id: String(product_id), quantity, in_stock: quantity > 0 };
  },

  async low_stock_products({ threshold = 5 }) {
    const data = await shopify(`/products.json?limit=50`);
    const low = (data.products || [])
      .map((p) => ({ name: p.title, qty: p.variants?.[0]?.inventory_quantity ?? 0 }))
      .filter((p) => p.qty <= Number(threshold));
    return { threshold: Number(threshold), products: low };
  },
};

const manifest = {
  appVersion: 'shopify-prebuilt-0.1',
  clientRevision: 0,
  documents: [],
  actions: standardActionLibrary().filter((a) =>
    ['search_product', 'get_product', 'check_stock', 'low_stock_products'].includes(a.name),
  ),
};

const client = new HelpdeskConnectorClient({
  baseUrl: HELPDESK_BASE_URL,
  token: HELPDESK_CONNECTOR_TOKEN,
  handlers,
  manifest,
});

console.log('Shopify connector starting…');
await client.syncManifest().catch((e) => console.error('Initial sync failed:', e.message));

async function loop() {
  try {
    await client.runCycle();
  } catch (e) {
    console.error('cycle error:', e.message);
  }
}
await loop();
setInterval(loop, 5000);
