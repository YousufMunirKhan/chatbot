export class HelpdeskConnectorClient {
  constructor({
    baseUrl,
    token,
    handlers = {},
    manifest,
    deliveryMode = 'polling_fallback',
    pollIntervalSeconds = 60,
  }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!token || !String(token).startsWith('hdk_')) {
      throw new Error('Connector token is required. Create a connector in Switch&Save Help Desk and paste the hdk_ token here.');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.handlers = handlers;
    this.manifest = manifest || defaultManifest();
    this.knownRevision = 0;
    this.deliveryMode = deliveryMode;
    this.pollIntervalSeconds = Math.max(5, Number(pollIntervalSeconds || 60));
  }

  async checkStatus() {
    return this.request('GET', '/api/helpdesk/connectors/status');
  }

  previewManifest() {
    return previewManifest(this.manifest, this.handlers);
  }

  auditManifest() {
    return auditManifest(this.manifest, this.handlers);
  }

  async syncManifest() {
    const audit = this.auditManifest();
    if (!audit.ok) {
      await this.reportHealth('sync_failed', {
        status: 'error',
        message: 'Manifest audit failed before sync.',
        metadata: audit,
      });
      throw new Error('Manifest audit failed: ' + audit.blocked.map((x) => x.message).join('; '));
    }

    const response = await this.request('POST', '/api/helpdesk/connectors/sync', {
      ...this.manifest,
      clientRevision: this.knownRevision,
    });
    this.knownRevision = Number(response.manifestRevision || this.knownRevision);
    return response;
  }

  async runCycle() {
    const status = await this.checkStatus();
    await this.handleSyncCommand(status);
    return this.pollOnce();
  }

  async pollOnce() {
    const started = Date.now();
    await this.reportHealth('poll_attempt', {
      status: 'info',
      pollIntervalSeconds: this.pollIntervalSeconds,
    });

    try {
      const response = await this.request('GET', '/api/helpdesk/connectors/events');
      await this.handleSyncCommand(response);
      const events = Array.isArray(response.events) ? response.events : [];

      for (const event of events) {
        await this.handleEvent(event);
      }

      await this.reportHealth('poll_success', {
        status: 'success',
        durationMs: Date.now() - started,
        eventsReturned: events.length,
        pollIntervalSeconds: this.pollIntervalSeconds,
      });
      return events.length;
    } catch (error) {
      await this.reportHealth('poll_failed', {
        status: 'error',
        durationMs: Date.now() - started,
        pollIntervalSeconds: this.pollIntervalSeconds,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async handleEvent(event) {
    const handler = this.handlers[event.name];
    if (!handler) {
      const message = `Unsupported event: ${event.name}`;
      await this.reportHealth('handler_missing', {
        status: 'error',
        actionName: event.name,
        eventId: event.id,
        message,
      });
      await this.sendEventResult(event.id, 'failed', null, message, 0);
      return;
    }

    const started = Date.now();
    try {
      const result = await handler(event.input || {});
      await this.sendEventResult(event.id, 'completed', result || {}, null, Date.now() - started);
    } catch (error) {
      await this.sendEventResult(
        event.id,
        'failed',
        null,
        error instanceof Error ? error.message : String(error),
        Date.now() - started,
      );
    }
  }

  async handleSyncCommand(response) {
    const serverRevision = Number(response.manifestRevision || this.knownRevision);
    if (response.syncRequired || serverRevision > this.knownRevision) {
      await this.syncManifest();
      this.knownRevision = serverRevision;
    }
  }

  async sendEventResult(eventId, status, response, error, durationMs) {
    return this.request('POST', '/api/helpdesk/connectors/events', {
      eventId,
      status,
      response,
      error,
      deliveryMode: this.deliveryMode,
      durationMs,
    });
  }

  async reportHealth(eventType, options = {}) {
    return this.request('POST', '/api/helpdesk/connectors/health', {
      eventType,
      deliveryMode: this.deliveryMode,
      status: options.status || 'info',
      message: options.message,
      eventId: options.eventId,
      actionName: options.actionName,
      durationMs: options.durationMs,
      pollIntervalSeconds: options.pollIntervalSeconds,
      eventsReturned: options.eventsReturned,
      metadata: options.metadata || {},
    });
  }

  async request(method, path, body) {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const data = safeJson(text);
    if (!response.ok) {
      throw new Error(formatApiError(response.status, data, text));
    }
    return data;
  }
}

function safeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function formatApiError(status, data, text) {
  const base = data.message || data.error || `Connector API error ${status}`;
  if (Array.isArray(data.issues) && data.issues.length) {
    return `${base}\n${data.issues.map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path || 'payload';
      return `- ${path}: ${issue.message || 'Invalid value'}`;
    }).join('\n')}`;
  }
  return text && !data.message && !data.error ? `${base}: ${text.slice(0, 1000)}` : base;
}

export function previewManifest(manifest, handlers = {}) {
  const docs = Array.isArray(manifest?.documents) ? manifest.documents : [];
  const actions = Array.isArray(manifest?.actions) ? manifest.actions : [];
  return [
    `App version: ${manifest?.appVersion || 'unknown'}`,
    `Documents: ${docs.length}`,
    `Actions: ${actions.length}`,
    '',
    'Screens',
    ...docs.map((doc) => {
      const nav = doc.navigation?.routeId ? ` [${doc.navigation.routeId}]` : '';
      return `- ${doc.module || 'Module'} > ${doc.screen || 'Screen'}: ${doc.path || 'No path'}${nav}`;
    }),
    '',
    'Actions',
    ...actions.map((a) => {
      const status = handlers[a.name] ? 'connected' : 'missing handler';
      return `- ${a.name} (${a.type}/${a.risk}) ${status}`;
    }),
  ].join('\n');
}

export function auditManifest(manifest, handlers = {}) {
  const blocked = [];
  const warnings = [];
  const passed = [];
  const docs = Array.isArray(manifest?.documents) ? manifest.documents : [];
  const actions = Array.isArray(manifest?.actions) ? manifest.actions : [];
  const docKeys = new Set();
  const actionNames = new Set();
  const routeIds = new Set();

  for (const doc of docs) {
    if (!doc.externalKey) blocked.push({ code: 'missing_external_key', message: 'A document is missing externalKey.' });
    if (doc.externalKey && docKeys.has(doc.externalKey)) blocked.push({ code: 'duplicate_external_key', message: `Duplicate document key: ${doc.externalKey}` });
    if (doc.externalKey) docKeys.add(doc.externalKey);
    if (!doc.module || !doc.screen || !doc.path) warnings.push({ code: 'missing_path', message: `${doc.externalKey || doc.screen} is missing module, screen, or path.` });
    if (!Array.isArray(doc.steps) || doc.steps.length < 2) warnings.push({ code: 'short_steps', message: `${doc.externalKey || doc.screen} has short or missing steps.` });
    const routeId = doc.navigation?.routeId;
    if (routeId && routeIds.has(routeId)) blocked.push({ code: 'duplicate_route_id', message: `Duplicate routeId: ${routeId}` });
    if (routeId) routeIds.add(routeId);
    const docText = JSON.stringify(doc).toLowerCase();
    if (/(api[_-]?key|password|secret|token|connection string|private key|cvv|card number)/i.test(docText)) {
      blocked.push({ code: 'possible_secret', message: `${doc.externalKey || doc.screen} may contain a secret or payment field.` });
    }
  }

  for (const actionDef of actions) {
    if (!/^[a-z][a-z0-9_]*$/.test(actionDef.name || '')) blocked.push({ code: 'bad_action_name', message: `Invalid action name: ${actionDef.name}` });
    if (actionNames.has(actionDef.name)) blocked.push({ code: 'duplicate_action', message: `Duplicate action: ${actionDef.name}` });
    actionNames.add(actionDef.name);
    if (!handlers[actionDef.name]) warnings.push({ code: 'missing_handler', message: `${actionDef.name} has no local handler connected.` });
    const risky = ['create', 'update', 'danger'].includes(actionDef.type) || actionDef.risk !== 'low';
    if (risky && !actionDef.needsConfirmation) blocked.push({ code: 'confirmation_required', message: `${actionDef.name} must require confirmation.` });
    if (actionDef.type === 'danger') blocked.push({ code: 'danger_disabled', message: `${actionDef.name} is dangerous and should stay disabled in V1.` });
  }

  if (blocked.length === 0) passed.push({ code: 'no_blockers', message: 'No blocking audit issues found.' });
  if (docs.length > 0) passed.push({ code: 'documents_present', message: `${docs.length} document(s) ready for preview.` });
  if (actions.length > 0) passed.push({ code: 'actions_present', message: `${actions.length} action(s) declared.` });

  return { ok: blocked.length === 0, passed, warnings, blocked };
}

export function defaultManifest() {
  return {
    appVersion: 'web-helpdesk-starter-0.2',
    clientRevision: 0,
    documents: [
      {
        externalKey: 'web.inventory.products',
        module: 'Inventory',
        screen: 'Products',
        path: 'Dashboard > Inventory > Products',
        purpose: 'Search, review, and manage products from the web dashboard.',
        steps: [
          'Open Dashboard.',
          'Open Inventory.',
          'Choose Products.',
          'Search by product name, SKU, or barcode.',
        ],
        fields: [
          { name: 'Search', required: false, description: 'Product name, SKU, or barcode.' },
          { name: 'Category', required: false, description: 'Optional product category filter.' },
        ],
        commonErrors: [
          'No products appear when filters are too narrow.',
          'Only manager or admin roles can edit stock.',
        ],
        actions: ['search_product', 'check_stock', 'update_product_quantity', 'update_product_price'],
        navigation: {
          label: 'Open Products',
          routeId: 'web.inventory.products',
          platformTargets: { web: { url: '/inventory/products' } },
        },
      },
      {
        externalKey: 'web.reports.daily-sales',
        module: 'Reports',
        screen: 'Daily Sales',
        path: 'Dashboard > Reports > Daily Sales',
        purpose: 'Review daily sales totals, order count, returns, discounts, and payment splits.',
        steps: ['Open Reports.', 'Choose Daily Sales.', 'Select date and branch.', 'Run report.'],
        fields: [
          { name: 'Date', required: true, description: 'Report date.' },
          { name: 'Branch', required: false, description: 'Optional branch filter.' },
        ],
        commonErrors: ['Report is empty when no completed orders exist for the selected date.'],
        actions: ['daily_sales_report', 'end_of_day_report'],
        navigation: {
          label: 'Open Daily Sales',
          routeId: 'web.reports.daily_sales',
          platformTargets: { web: { url: '/reports/daily-sales' } },
        },
      },
    ],
    actions: standardActionLibrary().filter((a) =>
      ['search_product', 'get_product', 'check_stock', 'daily_sales_report', 'end_of_day_report', 'update_product_quantity', 'update_product_price'].includes(a.name),
    ),
  };
}

export function standardActionLibrary() {
  return [
    action('search_product', 'Search products by name, SKU, or barcode.', 'read', 'low', ['query'], [], false, ['admin', 'manager', 'cashier']),
    action('get_product', 'Return one product by id.', 'read', 'low', ['product_id'], [], false, ['admin', 'manager', 'cashier']),
    action('create_product', 'Create a product.', 'create', 'medium', ['name', 'price'], ['sku', 'barcode', 'opening_stock'], true),
    action('update_product', 'Update product fields.', 'update', 'medium', ['product_id'], ['name', 'sku', 'barcode', 'category'], true),
    action('update_product_price', 'Update product sale price.', 'update', 'medium', ['product_id', 'price'], ['currency', 'reason'], true),
    action('update_product_quantity', 'Update stock quantity for one product.', 'update', 'medium', ['product_id', 'quantity'], ['branch_id', 'reason'], true),
    action('disable_product', 'Disable or hide a product.', 'update', 'high', ['product_id'], ['reason'], true),
    action('check_stock', 'Return current stock for one product.', 'read', 'low', ['product_id'], ['branch_id'], false, ['admin', 'manager', 'cashier']),
    action('low_stock_products', 'List products at or below stock threshold.', 'report', 'low', [], ['threshold', 'branch_id']),
    action('stock_adjustment_history', 'Return stock adjustment history.', 'report', 'low', ['product_id'], ['date_from', 'date_to']),
    action('search_customer', 'Search customers by name, phone, or email.', 'read', 'low', ['query']),
    action('create_customer', 'Create a customer record.', 'create', 'medium', ['name'], ['phone', 'email'], true),
    action('update_customer', 'Update customer fields.', 'update', 'medium', ['customer_id'], ['name', 'phone', 'email'], true),
    action('update_customer_phone', 'Update customer phone number.', 'update', 'medium', ['customer_id', 'phone'], ['reason'], true),
    action('search_order', 'Search orders.', 'read', 'low', ['query']),
    action('get_order_status', 'Return order status.', 'read', 'low', ['order_id']),
    action('create_order', 'Create an order.', 'create', 'medium', ['customer_id', 'items'], ['notes'], true),
    action('cancel_order', 'Cancel an order.', 'danger', 'high', ['order_id'], ['reason'], true),
    action('create_purchase_order', 'Create a supplier purchase order.', 'create', 'medium', ['supplier_id', 'items'], ['expected_date', 'notes'], true),
    action('search_invoice', 'Search invoices.', 'read', 'low', ['query']),
    action('get_invoice', 'Return invoice summary.', 'read', 'low', ['invoice_id']),
    action('daily_sales_report', 'Return sales summary for a date.', 'report', 'low', ['date'], ['branch_id']),
    action('end_of_day_report', 'Return end-of-day close summary.', 'report', 'low', ['date'], ['branch_id']),
    action('stock_value_report', 'Return stock value summary.', 'report', 'low', [], ['branch_id']),
    action('create_support_ticket', 'Create an internal support ticket.', 'create', 'low', ['summary'], ['details']),
    action('add_customer_note', 'Add a note to a customer record.', 'create', 'medium', ['customer_id', 'note'], [], true),
  ];
}

function action(name, description, type, risk, requiredFields, optionalFields = [], needsConfirmation = false, allowedRoles = ['admin', 'manager']) {
  return {
    name,
    description,
    type,
    risk,
    requiredFields,
    optionalFields,
    allowedRoles,
    needsConfirmation,
  };
}
