import { HelpdeskConnectorClient, standardActionLibrary } from './HelpdeskConnectorClient.js';

/*
 * Fill this file with the CUSTOMER APP'S real details.
 *
 * This is the first file a web developer or AI coding agent should edit.
 * Keep the hdk_ connector token on the backend. Do not import this file into a
 * public browser bundle unless the page is fully staff-authenticated and the
 * token is injected only server-side.
 *
 * The starter manifest is a POS example. Use docs/AUTO_DISCOVERY_PLAYBOOK.md to
 * scan the real app menus/routes and replace these samples before production.
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
        externalKey: 'inventory.add_product',
        module: 'Inventory',
        screen: 'Add Product',
        path: 'Dashboard > Inventory > Products > Add Product',
        purpose: 'Create a new product with name, SKU, barcode, sale price, tax, category, and opening stock.',
        steps: ['Open Dashboard.', 'Open Inventory.', 'Choose Products.', 'Click Add Product.', 'Enter details and save.'],
        fields: [
          { name: 'Product name', required: true, description: 'Name shown in search, receipts, and reports.' },
          { name: 'SKU/barcode', required: false, description: 'Unique SKU or barcode.' },
          { name: 'Sale price', required: true, description: 'Selling price used at checkout.' },
        ],
        commonErrors: ['SKU or barcode already exists.', 'Price is required before saving.'],
        actions: ['search_product', 'create_product'],
        navigation: webRoute('Open Add Product', 'inventory.add_product', '/inventory/products/new'),
      }),
      screenDoc({
        externalKey: 'orders.list',
        module: 'Orders',
        screen: 'Order List',
        path: 'Dashboard > Orders',
        purpose: 'Search, review, print, refund, or check payment and fulfilment status for orders.',
        steps: ['Open Dashboard.', 'Open Orders.', 'Search by order number, customer, date, or status.', 'Open an order to review details.'],
        fields: [
          { name: 'Search', required: false, description: 'Order number, customer, or receipt reference.' },
          { name: 'Date range', required: false, description: 'Filter orders by date.' },
        ],
        commonErrors: ['Offline orders may appear after sync completes.', 'Refund actions may require manager approval.'],
        actions: ['search_order', 'get_order_status'],
        navigation: webRoute('Open Orders', 'orders.list', '/orders'),
      }),
      screenDoc({
        externalKey: 'orders.create',
        module: 'Orders',
        screen: 'Create Order',
        path: 'Dashboard > Orders > New Order',
        purpose: 'Create a POS order by adding products, customer details, discounts, payment, and fulfilment information.',
        steps: ['Open Dashboard.', 'Open Orders.', 'Choose New Order.', 'Add products.', 'Take payment or save the order.'],
        fields: [
          { name: 'Product search', required: true, description: 'Products to add to the order.' },
          { name: 'Customer', required: false, description: 'Optional customer linked to the order.' },
        ],
        commonErrors: ['Product is out of stock.', 'Payment terminal is offline.'],
        actions: ['search_product', 'create_order'],
        navigation: webRoute('Open New Order', 'orders.create', '/orders/new'),
      }),
      screenDoc({
        externalKey: 'customers.list',
        module: 'Customers',
        screen: 'Customer Management',
        path: 'Dashboard > Customers',
        purpose: 'Find, create, or update customer records used for delivery, collection, account sales, and history.',
        steps: ['Open Dashboard.', 'Open Customers.', 'Search by name, phone, or email.', 'Open the customer record.'],
        fields: [
          { name: 'Search', required: false, description: 'Name, phone, email, or customer code.' },
          { name: 'Phone', required: false, description: 'Customer phone number.' },
        ],
        commonErrors: ['Duplicate customers may exist with similar phone numbers.'],
        actions: ['search_customer', 'create_customer', 'update_customer_phone'],
        navigation: webRoute('Open Customers', 'customers.list', '/customers'),
      }),
      screenDoc({
        externalKey: 'purchase_orders.create',
        module: 'Purchase',
        screen: 'Create Purchase Order',
        path: 'Dashboard > Purchase > Purchase Orders > New',
        purpose: 'Create a supplier purchase order with products, quantities, costs, and expected receiving dates.',
        steps: ['Open Dashboard.', 'Open Purchase.', 'Open Purchase Orders.', 'Choose New Purchase Order.', 'Select supplier and add products.', 'Save or send the order.'],
        fields: [
          { name: 'Supplier', required: true, description: 'Supplier receiving the purchase order.' },
          { name: 'Products', required: true, description: 'Products and quantities to order.' },
        ],
        commonErrors: ['Supplier is required.', 'Product cost may be missing.'],
        actions: ['create_purchase_order', 'search_product'],
        navigation: webRoute('Open Purchase Order', 'purchase_orders.create', '/purchase/orders/new'),
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
      screenDoc({
        externalKey: 'settings.main',
        module: 'Settings',
        screen: 'Settings',
        path: 'Dashboard > Settings',
        purpose: 'Configure POS, printers, payment terminals, tax, sync, staff, branch, and application settings.',
        steps: ['Open Dashboard.', 'Open Settings.', 'Choose a setting category.', 'Review current values.', 'Save changes if permitted.'],
        fields: [{ name: 'Setting category', required: false, description: 'Printer, payment, tax, sync, staff, or branch settings.' }],
        commonErrors: ['Some settings require admin permission.', 'Printer/payment settings may require network or device connectivity.'],
        actions: [],
        navigation: webRoute('Open Settings', 'settings.main', '/settings'),
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
        'create_product',
        'search_customer',
        'create_customer',
        'update_customer_phone',
        'search_order',
        'get_order_status',
        'create_order',
        'create_purchase_order',
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

    low_stock_products: async (input) => {
      requireService(productService, 'productService.lowStock');
      return { results: await productService.lowStock(input.threshold, input.branch_id) };
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
    'inventory.add_product': '/inventory/products/new',
    'orders.list': '/orders',
    'orders.create': '/orders/new',
    'customers.list': '/customers',
    'purchase_orders.create': '/purchase/orders/new',
    'reports.daily_sales': '/reports/daily-sales',
    'settings.main': '/settings',
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
