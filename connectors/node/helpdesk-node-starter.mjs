/*
 * Plug-and-play Node starter.
 *
 * Run:
 *   HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk \
 *   HELPDESK_CONNECTOR_TOKEN=hdk_your_token \
 *   node helpdesk-node-starter.mjs
 *
 * Replace sampleProductService and sampleReportService with real app services.
 */

const { createHelpdeskConnector } = await importWebAppDetails();

async function importWebAppDetails() {
  try {
    return await import('./HelpdeskWebAppDetails.js');
  } catch {
    return import('../web/HelpdeskWebAppDetails.js');
  }
}

const productRows = [
  { id: 'p_100', name: 'Pepsi 500ml', sku: 'PEP500', price: 120, quantity: 24 },
  { id: 'p_101', name: 'Water 1.5L', sku: 'WAT1500', price: 90, quantity: 4 },
  { id: 'p_102', name: 'Chips Salted', sku: 'CHP001', price: 60, quantity: 2 },
];

const sampleProductService = {
  async search(query = '') {
    const q = String(query).toLowerCase();
    return productRows.filter((product) =>
      product.name.toLowerCase().includes(q) || product.sku.toLowerCase().includes(q),
    );
  },

  async get(productId) {
    const product = productRows.find((row) => row.id === productId);
    if (!product) throw new Error('Product not found.');
    return product;
  },

  async checkStock(productId) {
    const product = await this.get(productId);
    return { product_id: product.id, name: product.name, quantity: product.quantity, in_stock: product.quantity > 0 };
  },

  async lowStock(threshold = 5) {
    const limit = Number(threshold || 5);
    return productRows.filter((product) => product.quantity <= limit);
  },

  async updateQuantity(productId, quantity, reason) {
    const product = await this.get(productId);
    product.quantity = Number(quantity);
    return { success: true, product_id: product.id, quantity: product.quantity, reason: reason || null };
  },

  async updatePrice(productId, price, reason) {
    const product = await this.get(productId);
    product.price = Number(price);
    return { success: true, product_id: product.id, price: product.price, reason: reason || null };
  },
};

const sampleReportService = {
  async dailySales(date) {
    return { date: date || new Date().toISOString().slice(0, 10), gross_sales: 142500, orders: 87, currency: 'PKR' };
  },

  async endOfDay(date) {
    return { date: date || new Date().toISOString().slice(0, 10), cash: 78500, card: 64000, returns: 2, currency: 'PKR' };
  },
};

const connector = createHelpdeskConnector({
  productService: sampleProductService,
  reportService: sampleReportService,
  staffRoleProvider: () => 'admin',
});

console.log('\nSwitch&Save Help Desk Node starter\n');
console.log(connector.previewManifest());

const audit = connector.auditManifest();
console.log('\nAudit');
console.log(JSON.stringify(audit, null, 2));

if (!audit.ok) {
  console.error('\nFix audit blockers before sync.');
  process.exit(1);
}

if (process.argv.includes('--preview-only')) {
  console.log('\nPreview-only mode complete.');
  process.exit(0);
}

try {
  const sync = await connector.syncManifest();
  console.log('\nSync complete');
  console.log(JSON.stringify(sync, null, 2));
} catch (error) {
  console.error('\nSync failed');
  console.error(error?.message || error);
  process.exit(1);
}

if (process.argv.includes('--once')) {
  const count = await connector.runCycle();
  console.log(`\nRun cycle complete. Events handled: ${count}`);
  process.exit(0);
}

console.log('\nPolling every 5 seconds. Press Ctrl+C to stop.');
setInterval(async () => {
  try {
    const count = await connector.runCycle();
    if (count > 0) console.log(`Handled ${count} event(s).`);
  } catch (error) {
    console.error('Cycle failed:', error?.message || error);
  }
}, 5000);
