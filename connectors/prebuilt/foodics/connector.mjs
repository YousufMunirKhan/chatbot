/**
 * Pre-built Foodics connector (turnkey) — popular POS across MENA.
 *
 * Maps the standard Help Desk actions to the Foodics API v5.
 *
 * Required env:
 *   HELPDESK_BASE_URL          e.g. https://app.yourdomain.com
 *   HELPDESK_CONNECTOR_TOKEN   hdk_… token from the Help Desk dashboard
 *   FOODICS_API_TOKEN          Foodics business API token
 *   FOODICS_BASE_URL           default https://api.foodics.com
 *
 * Run:  node connectors/prebuilt/foodics/connector.mjs
 */
import { HelpdeskConnectorClient, standardActionLibrary } from '../../web/HelpdeskConnectorClient.js';

const {
  HELPDESK_BASE_URL,
  HELPDESK_CONNECTOR_TOKEN,
  FOODICS_API_TOKEN,
  FOODICS_BASE_URL = 'https://api.foodics.com',
} = process.env;

for (const [k, v] of Object.entries({ HELPDESK_BASE_URL, HELPDESK_CONNECTOR_TOKEN, FOODICS_API_TOKEN })) {
  if (!v) {
    console.error(`Missing required env: ${k}`);
    process.exit(1);
  }
}

async function foodics(path) {
  const res = await fetch(`${FOODICS_BASE_URL.replace(/\/+$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${FOODICS_API_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Foodics ${res.status}: ${await res.text()}`);
  return res.json();
}

const handlers = {
  async search_product({ query }) {
    const data = await foodics(`/v5/products?filter[name]=${encodeURIComponent(query || '')}&include=category`);
    return {
      results: (data.data || []).map((p) => ({
        product_id: p.id,
        name: p.name,
        sku: p.sku || null,
        price: p.price ?? null,
        category: p.category?.name || null,
      })),
    };
  },

  async get_product({ product_id }) {
    const data = await foodics(`/v5/products/${encodeURIComponent(product_id)}`);
    const p = data.data;
    return p ? { product_id: p.id, name: p.name, sku: p.sku, price: p.price } : { error: 'not_found' };
  },

  async daily_sales_report({ date, branch_id }) {
    const params = new URLSearchParams();
    if (date) params.set('filter[business_date]', date);
    if (branch_id) params.set('filter[branch_id]', branch_id);
    const data = await foodics(`/v5/orders?${params.toString()}`);
    const orders = data.data || [];
    const total = orders.reduce((sum, o) => sum + Number(o.total_price || 0), 0);
    return { date: date || null, order_count: orders.length, total_sales: total };
  },
};

const manifest = {
  appVersion: 'foodics-prebuilt-0.1',
  clientRevision: 0,
  documents: [],
  actions: standardActionLibrary().filter((a) =>
    ['search_product', 'get_product', 'daily_sales_report'].includes(a.name),
  ),
};

const client = new HelpdeskConnectorClient({
  baseUrl: HELPDESK_BASE_URL,
  token: HELPDESK_CONNECTOR_TOKEN,
  handlers,
  manifest,
});

console.log('Foodics connector starting…');
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
