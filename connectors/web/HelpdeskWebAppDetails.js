import { HelpdeskConnectorClient, standardActionLibrary } from './HelpdeskConnectorClient.js';

/*
 * Fill this file with the CUSTOMER APP'S real details.
 *
 * This is the first file a web developer or AI coding agent should edit.
 * Keep the hdk_ connector token on the backend. Do not import this file into a
 * public browser bundle unless the page is fully staff-authenticated and the
 * token is injected only server-side.
 */

export function createHelpdeskConnector({
  baseUrl = process.env.HELPDESK_BASE_URL,
  token = process.env.HELPDESK_CONNECTOR_TOKEN,
  productService,
  reportService,
  staffRoleProvider = () => 'admin',
  openRoute = () => false,
} = {}) {
  const handlers = buildHandlers({ productService, reportService, staffRoleProvider });

  return new HelpdeskConnectorClient({
    baseUrl,
    token,
    manifest: buildManifest(),
    handlers,
  });
}

export function buildManifest() {
  return {
    appVersion: 'web-helpdesk-starter-0.3',
    clientRevision: 0,
    documents: [
      screenDoc({
        externalKey: 'dashboard.main',
        module: 'Dashboard',
        screen: 'Main Menu',
        path: 'Dashboard > Main Menu',
        purpose: 'Start orders, open management areas, review sync state, and access daily operations.',
        steps: ['Log in as staff.', 'Open Dashboard.', 'Choose the required menu item.'],
        fields: [{ name: 'Current branch', required: false, description: 'Branch currently selected in the app.' }],
        commonErrors: ['Staff role may hide manager-only menu items.'],
        actions: ['daily_sales_report'],
        navigation: webRoute('Open Dashboard', 'dashboard.main', '/dashboard'),
      }),
      screenDoc({
        externalKey: 'inventory.products',
        module: 'Inventory',
        screen: 'Products',
        path: 'Dashboard > Inventory > Products',
        purpose: 'Search products, check stock, update sale price, and adjust stock quantity.',
        steps: ['Open Dashboard.', 'Open Inventory.', 'Choose Products.', 'Search by name, SKU, barcode, or QR PLU.'],
        fields: [
          { name: 'Search', required: false, description: 'Product name, SKU, barcode, or QR PLU.' },
          { name: 'Quantity', required: false, description: 'Current stock quantity.' },
          { name: 'Sale price', required: false, description: 'Current selling price.' },
        ],
        commonErrors: ['No products appear when filters are too narrow.', 'Only manager/admin roles can update stock or price.'],
        actions: ['search_product', 'get_product', 'check_stock', 'update_product_quantity', 'update_product_price'],
        navigation: webRoute('Open Products', 'inventory.products', '/inventory/products'),
      }),
      screenDoc({
        externalKey: 'reports.daily_sales',
        module: 'Reports',
        screen: 'Daily Sales',
        path: 'Dashboard > Reports > Daily Sales',
        purpose: 'Review daily sales totals, order count, returns, discounts, cash, and card totals.',
        steps: ['Open Dashboard.', 'Open Reports.', 'Choose Daily Sales.', 'Select date and branch.', 'Run report.'],
        fields: [
          { name: 'Date', required: true, description: 'Report date.' },
          { name: 'Branch', required: false, description: 'Optional branch filter.' },
        ],
        commonErrors: ['Report is empty when no completed orders exist for the selected date.'],
        actions: ['daily_sales_report', 'end_of_day_report'],
        navigation: webRoute('Open Daily Sales', 'reports.daily_sales', '/reports/daily-sales'),
      }),
    ],
    actions: standardActionLibrary().filter((action) =>
      [
        'search_product',
        'get_product',
        'check_stock',
        'low_stock_products',
        'daily_sales_report',
        'end_of_day_report',
        'update_product_quantity',
        'update_product_price',
      ].includes(action.name),
    ),
  };
}

export function buildHandlers({ productService, reportService, staffRoleProvider }) {
  return {
    search_product: async (input) => {
      requireService(productService, 'productService.search');
      return { results: await productService.search(input.query) };
    },

    get_product: async (input) => {
      requireService(productService, 'productService.get');
      return productService.get(input.product_id);
    },

    check_stock: async (input) => {
      requireService(productService, 'productService.checkStock');
      return productService.checkStock(input.product_id, input.branch_id);
    },

    daily_sales_report: async (input) => {
      requireService(reportService, 'reportService.dailySales');
      return reportService.dailySales(input.date, input.branch_id);
    },

    end_of_day_report: async (input) => {
      requireService(reportService, 'reportService.endOfDay');
      return reportService.endOfDay(input.date, input.branch_id);
    },

    update_product_quantity: async (input) => {
      requireManager(staffRoleProvider());
      requireConfirmed(input);
      requireService(productService, 'productService.updateQuantity');
      return productService.updateQuantity(input.product_id, input.quantity, input.reason);
    },

    update_product_price: async (input) => {
      requireManager(staffRoleProvider());
      requireConfirmed(input);
      requireService(productService, 'productService.updatePrice');
      return productService.updatePrice(input.product_id, input.price, input.reason);
    },
  };
}

export function openHelpdeskRoute(routeId, router) {
  const routes = {
    'dashboard.main': '/dashboard',
    'inventory.products': '/inventory/products',
    'reports.daily_sales': '/reports/daily-sales',
  };
  const url = routes[routeId];
  if (!url) return false;
  router.push ? router.push(url) : router.navigate(url);
  return true;
}

function screenDoc({ externalKey, module, screen, path, purpose, steps, fields, commonErrors, actions, navigation }) {
  return {
    externalKey,
    module,
    screen,
    path,
    purpose,
    steps,
    fields,
    commonErrors,
    actions,
    navigation,
    needsReview: false,
  };
}

function webRoute(label, routeId, url) {
  return {
    label,
    routeId,
    platformTargets: { web: { url } },
  };
}

function requireService(service, name) {
  if (!service) throw new Error(`${name} is not connected. Replace HelpdeskWebAppDetails.js placeholders with real app services.`);
}

function requireManager(role) {
  if (!['admin', 'manager'].includes(String(role || '').toLowerCase())) {
    throw new Error('Current staff role is not allowed to run this action.');
  }
}

function requireConfirmed(input) {
  if (!input?.confirmed) throw new Error('This action requires confirmed=true before execution.');
}
