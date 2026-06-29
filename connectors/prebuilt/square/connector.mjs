/**
 * Pre-built Square connector (turnkey).
 *
 * Maps the standard Help Desk actions to the Square Catalog + Inventory APIs.
 *
 * Required env:
 *   HELPDESK_BASE_URL          e.g. https://app.yourdomain.com
 *   HELPDESK_CONNECTOR_TOKEN   hdk_… token from the Help Desk dashboard
 *   SQUARE_ACCESS_TOKEN        Square access token (ITEMS_READ, INVENTORY_READ)
 *   SQUARE_ENV                 'production' | 'sandbox' (default production)
 *
 * Run:  node connectors/prebuilt/square/connector.mjs
 */
import { HelpdeskConnectorClient, standardActionLibrary } from '../../web/HelpdeskConnectorClient.js';

const { HELPDESK_BASE_URL, HELPDESK_CONNECTOR_TOKEN, SQUARE_ACCESS_TOKEN, SQUARE_ENV = 'production' } = process.env;

for (const [k, v] of Object.entries({ HELPDESK_BASE_URL, HELPDESK_CONNECTOR_TOKEN, SQUARE_ACCESS_TOKEN })) {
  if (!v) {
    console.error(`Missing required env: ${k}`);
    process.exit(1);
  }
}

const base = SQUARE_ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';

async function square(path, body) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Square ${res.status}: ${await res.text()}`);
  return res.json();
}

const handlers = {
  async search_product({ query }) {
    const data = await square('/v2/catalog/search', {
      object_types: ['ITEM'],
      query: { text_query: { keywords: [String(query || '')] } },
      limit: 10,
    });
    return {
      results: (data.objects || []).map((o) => ({
        product_id: o.id,
        name: o.item_data?.name,
        variations: (o.item_data?.variations || []).map((v) => ({
          variation_id: v.id,
          name: v.item_variation_data?.name,
          price: v.item_variation_data?.price_money?.amount ?? null,
        })),
      })),
    };
  },

  async get_product({ product_id }) {
    const data = await square(`/v2/catalog/object/${encodeURIComponent(product_id)}`);
    const o = data.object;
    return o ? { product_id: o.id, name: o.item_data?.name } : { error: 'not_found' };
  },

  async check_stock({ product_id }) {
    // product_id here is a catalog variation id.
    const data = await square('/v2/inventory/counts/batch-retrieve', { catalog_object_ids: [product_id] });
    const quantity = (data.counts || []).reduce((sum, c) => sum + Number(c.quantity || 0), 0);
    return { product_id, quantity, in_stock: quantity > 0 };
  },
};

const manifest = {
  appVersion: 'square-prebuilt-0.1',
  clientRevision: 0,
  documents: [],
  actions: standardActionLibrary().filter((a) => ['search_product', 'get_product', 'check_stock'].includes(a.name)),
};

const client = new HelpdeskConnectorClient({
  baseUrl: HELPDESK_BASE_URL,
  token: HELPDESK_CONNECTOR_TOKEN,
  handlers,
  manifest,
});

console.log('Square connector starting…');
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
