export class HelpdeskConnectorClient {
  constructor({ baseUrl, token, handlers = {}, manifest }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!token) throw new Error('token is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.handlers = handlers;
    this.manifest = manifest || defaultManifest();
    this.knownRevision = 0;
  }

  async checkStatus() {
    return this.request('GET', '/api/helpdesk/connectors/status');
  }

  async syncManifest() {
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
    const response = await this.request('GET', '/api/helpdesk/connectors/events');
    await this.handleSyncCommand(response);
    const events = Array.isArray(response.events) ? response.events : [];

    for (const event of events) {
      const handler = this.handlers[event.name];
      if (!handler) {
        await this.sendEventResult(event.id, 'failed', null, `Unsupported event: ${event.name}`);
        continue;
      }

      try {
        const result = await handler(event.input || {});
        await this.sendEventResult(event.id, 'completed', result || {}, null);
      } catch (error) {
        await this.sendEventResult(
          event.id,
          'failed',
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return events.length;
  }

  async handleSyncCommand(response) {
    const serverRevision = Number(response.manifestRevision || this.knownRevision);
    if (response.syncRequired || serverRevision > this.knownRevision) {
      await this.syncManifest();
      this.knownRevision = serverRevision;
    }
  }

  async sendEventResult(eventId, status, response, error) {
    return this.request('POST', '/api/helpdesk/connectors/events', {
      eventId,
      status,
      response,
      error,
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
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data.error || `Connector API error ${response.status}`);
    }
    return data;
  }
}

export function defaultManifest() {
  return {
    appVersion: 'web-helpdesk-starter-0.1',
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
        actions: ['search_product', 'check_stock', 'update_product_quantity'],
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
      },
    ],
    actions: [
      action('search_product', 'Search products by name, SKU, or barcode.', 'read', 'low', ['query']),
      action('check_stock', 'Return current stock for one product.', 'read', 'low', ['product_id'], ['branch_id']),
      action('daily_sales_report', 'Return sales summary for a date.', 'report', 'low', ['date'], ['branch_id']),
      action('end_of_day_report', 'Return end-of-day close summary.', 'report', 'low', ['date'], ['branch_id']),
      action(
        'update_product_quantity',
        'Update stock quantity for one product.',
        'update',
        'medium',
        ['product_id', 'quantity'],
        ['branch_id', 'reason'],
        true,
      ),
    ],
  };
}

function action(name, description, type, risk, requiredFields, optionalFields = [], needsConfirmation = false) {
  return {
    name,
    description,
    type,
    risk,
    requiredFields,
    optionalFields,
    allowedRoles: ['admin', 'manager'],
    needsConfirmation,
  };
}
