import { createSupabaseServiceClient } from '@/lib/db/server';
import type { AssistantTool } from './types';
import { str } from './types';

/**
 * Order tracking tools (Module 17). Order details are NEVER revealed from an
 * order number alone — the customer must be verified with order number + phone
 * OR order number + email first.
 */
async function findVerifiedOrder(
  companyId: string,
  orderNumber: string,
  phone: string,
  email: string,
) {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('synced_orders')
    .select('*')
    .eq('company_id', companyId)
    .eq('order_number', orderNumber)
    .maybeSingle();
  if (!data) return null;
  const o = data as Record<string, unknown>;
  const phoneOk = phone && o.customer_phone && String(o.customer_phone).replace(/\s/g, '') === phone.replace(/\s/g, '');
  const emailOk =
    email && o.customer_email && String(o.customer_email).toLowerCase() === email.toLowerCase();
  return phoneOk || emailOk ? o : null;
}

const verificationParams = {
  type: 'object',
  properties: {
    order_number: { type: 'string' },
    phone: { type: 'string', description: 'Customer phone (provide this OR email)' },
    email: { type: 'string', description: 'Customer email (provide this OR phone)' },
  },
  required: ['order_number'],
} as const;

export const verifyCustomerForOrder: AssistantTool = {
  capabilities: ['order_tracking'],
  schema: {
    name: 'verify_customer_for_order',
    description:
      'Verify a customer owns an order using order number + phone OR order number + email. Must succeed before revealing any order details.',
    parameters: verificationParams as unknown as Record<string, unknown>,
  },
  async execute(input, ctx) {
    const order = await findVerifiedOrder(ctx.companyId, str(input, 'order_number'), str(input, 'phone'), str(input, 'email'));
    return { verified: Boolean(order) };
  },
};

export const getOrderStatus: AssistantTool = {
  capabilities: ['order_tracking'],
  schema: {
    name: 'get_order_status',
    description: 'Get order status AFTER verification (requires order number + phone/email).',
    parameters: verificationParams as unknown as Record<string, unknown>,
  },
  async execute(input, ctx) {
    const order = await findVerifiedOrder(ctx.companyId, str(input, 'order_number'), str(input, 'phone'), str(input, 'email'));
    if (!order) return { verified: false };
    return {
      verified: true,
      status: order.status,
      fulfillment_status: order.fulfillment_status,
      total: order.total,
      currency: order.currency,
      placed_at: order.placed_at,
    };
  },
};

export const getOrderItems: AssistantTool = {
  capabilities: ['order_tracking'],
  schema: {
    name: 'get_order_items',
    description: 'Get the line items of a verified order.',
    parameters: verificationParams as unknown as Record<string, unknown>,
  },
  async execute(input, ctx) {
    const order = await findVerifiedOrder(ctx.companyId, str(input, 'order_number'), str(input, 'phone'), str(input, 'email'));
    if (!order) return { verified: false };
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('synced_order_items')
      .select('title,quantity,price')
      .eq('order_id', order.id as string);
    return { verified: true, items: data ?? [] };
  },
};

export const getTrackingInfo: AssistantTool = {
  capabilities: ['order_tracking'],
  schema: {
    name: 'get_tracking_info',
    description: 'Get shipment tracking number/URL for a verified order.',
    parameters: verificationParams as unknown as Record<string, unknown>,
  },
  async execute(input, ctx) {
    const order = await findVerifiedOrder(ctx.companyId, str(input, 'order_number'), str(input, 'phone'), str(input, 'email'));
    if (!order) return { verified: false };
    return {
      verified: true,
      tracking_number: order.tracking_number,
      tracking_url: order.tracking_url,
      fulfillment_status: order.fulfillment_status,
    };
  },
};

export const orderTools = [verifyCustomerForOrder, getOrderStatus, getOrderItems, getTrackingInfo];
