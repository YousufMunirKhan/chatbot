export function standardHelpdeskEvents() {
  return [
    event('search_product', 'Search products by name, SKU, or barcode.', 'read', 'low', ['query'], [], false, ['admin', 'manager', 'cashier']),
    event('get_product', 'Return one product by id.', 'read', 'low', ['product_id'], [], false, ['admin', 'manager', 'cashier']),
    event('create_product', 'Create a product.', 'create', 'medium', ['name', 'price'], ['sku', 'barcode', 'category_id', 'category_name', 'opening_stock'], true),
    event('update_product', 'Update product fields.', 'update', 'medium', ['product_id'], ['name', 'sku', 'barcode', 'category_id', 'category_name', 'price'], true),
    event('update_product_price', 'Update product sale price.', 'update', 'medium', ['product_id', 'price'], ['currency', 'reason'], true),
    event('update_product_quantity', 'Update stock quantity for one product.', 'update', 'medium', ['product_id', 'quantity'], ['branch_id', 'reason'], true),
    event('disable_product', 'Disable or hide a product.', 'update', 'high', ['product_id'], ['reason'], true, ['admin', 'manager'], false),
    event('check_stock', 'Return current stock for one product.', 'read', 'low', ['product_id'], ['branch_id'], false, ['admin', 'manager', 'cashier']),
    event('low_stock_products', 'List products at or below stock threshold.', 'report', 'low', [], ['threshold', 'branch_id']),
    event('stock_adjustment_history', 'Return stock adjustment history.', 'report', 'low', ['product_id'], ['date_from', 'date_to']),
    event('search_customer', 'Search customers by name, phone, or email.', 'read', 'low', ['query']),
    event('create_customer', 'Create a customer record.', 'create', 'medium', ['name'], ['phone', 'email'], true),
    event('update_customer', 'Update customer fields.', 'update', 'medium', ['customer_id'], ['name', 'phone', 'email'], true),
    event('update_customer_phone', 'Update customer phone number.', 'update', 'medium', ['customer_id', 'phone'], ['reason'], true),
    event('search_order', 'Search orders.', 'read', 'low', ['query'], [], false, ['admin', 'manager', 'cashier']),
    event('get_order_status', 'Return order status.', 'read', 'low', ['order_id'], [], false, ['admin', 'manager', 'cashier']),
    event('create_order', 'Create an order.', 'create', 'medium', ['items'], ['customer_id', 'notes'], true),
    event('cancel_order', 'Cancel an order.', 'danger', 'high', ['order_id'], ['reason'], true, ['admin', 'manager'], false),
    event('create_purchase_order', 'Create a supplier purchase order.', 'create', 'medium', ['supplier_id', 'items'], ['expected_date', 'notes'], true),
    event('search_invoice', 'Search invoices.', 'read', 'low', ['query']),
    event('get_invoice', 'Return invoice summary.', 'read', 'low', ['invoice_id']),
    event('daily_sales_report', 'Return sales summary for a date.', 'report', 'low', ['date'], ['branch_id']),
    event('end_of_day_report', 'Return end-of-day close summary.', 'report', 'low', ['date'], ['branch_id']),
    event('stock_value_report', 'Return stock value summary.', 'report', 'low', [], ['branch_id']),
    event('create_support_ticket', 'Create an internal support ticket.', 'create', 'low', ['summary'], ['details'], true, ['admin', 'manager', 'cashier']),
    event('add_customer_note', 'Add a note to a customer record.', 'create', 'medium', ['customer_id', 'note'], [], true),
  ];
}

export const STANDARD_HELPDESK_EVENT_NAMES = standardHelpdeskEvents().map((item) => item.name);

function event(
  name,
  description,
  type,
  risk,
  requiredFields,
  optionalFields = [],
  needsConfirmation = false,
  allowedRoles = ['admin', 'manager'],
  enabled = true,
) {
  return {
    name,
    description,
    type,
    risk,
    requiredFields,
    optionalFields,
    allowedRoles,
    needsConfirmation,
    enabled,
  };
}
