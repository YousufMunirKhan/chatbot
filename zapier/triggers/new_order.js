'use strict';

const { restHookTrigger } = require('../utils');

/**
 * Orders placed inside a conversation.
 *
 * Orders mirrored from a connected store (Shopify, WooCommerce) deliberately do
 * NOT fire this: they arrive in bulk on every sync, so a first import would set
 * off thousands of Zaps at once — and those stores have their own Zapier apps
 * for exactly this.
 */
module.exports = restHookTrigger({
  key: 'new_order',
  noun: 'Order',
  label: 'New Order',
  description: 'Triggers when a customer places an order in a conversation.',
  event: 'order.placed',
  outputFields: [
    { key: 'id', label: 'Order ID' },
    { key: 'source', label: 'Source' },
    { key: 'order_number', label: 'Order number' },
    { key: 'status', label: 'Status' },
    { key: 'order_type', label: 'Order type' },
    { key: 'customer_name', label: 'Customer name' },
    { key: 'customer_email', label: 'Customer email' },
    { key: 'customer_phone', label: 'Customer phone' },
    { key: 'total', label: 'Total', type: 'number' },
    { key: 'currency', label: 'Currency' },
    { key: 'conversation_id', label: 'Conversation ID' },
    { key: 'created_at', label: 'Placed at' },
  ],
  sample: {
    id: '7c3a91e0-0000-4000-8000-000000000000',
    source: 'chat',
    order_number: null,
    status: 'pending',
    order_type: 'internal',
    customer_name: 'Sample Customer',
    customer_email: 'customer@example.com',
    customer_phone: null,
    total: 49.99,
    currency: 'USD',
    conversation_id: '2b7d0c11-0000-4000-8000-000000000000',
    created_at: '2026-01-01T09:00:00.000Z',
  },
});
