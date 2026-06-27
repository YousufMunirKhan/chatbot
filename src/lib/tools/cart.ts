import { createSupabaseServiceClient } from '@/lib/db/server';
import { serverEnv, env as publicEnv } from '@/lib/env';
import { notify } from '@/lib/notify';
import { decryptSecret } from '@/lib/crypto';
import type { AssistantTool, ToolContext } from './types';
import { num, str } from './types';

/**
 * Conversational order placement (Module 18). The BACKEND computes prices,
 * validates required options, and only creates an order on explicit confirmation
 * — the AI never invents totals or skips required restaurant modifiers.
 */
const ORDER_CAPS = ['order_placement'];

async function recomputeCart(cartId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb.from('chat_cart_items').select('line_total').eq('cart_id', cartId);
  const subtotal = (data ?? []).reduce((s, r) => s + Number((r as { line_total?: number }).line_total ?? 0), 0);
  await sb.from('chat_carts').update({ subtotal, updated_at: new Date().toISOString() }).eq('id', cartId);
  return subtotal;
}

/** Load + decrypt the company's WooCommerce credentials (backend only). */
async function getWooCreds(
  companyId: string,
): Promise<{ base: string; key: string; secret: string } | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('integration_accounts')
    .select('credentials_encrypted')
    .eq('company_id', companyId)
    .eq('provider', 'woocommerce')
    .eq('status', 'connected')
    .maybeSingle();
  const enc = (data as { credentials_encrypted?: string } | null)?.credentials_encrypted;
  if (!enc) return null;
  try {
    const creds = JSON.parse(decryptSecret(enc)) as Record<string, unknown>;
    const base = String(creds.base_url ?? '').replace(/\/$/, '');
    const key = String(creds.consumer_key ?? '');
    const secret = String(creds.consumer_secret ?? '');
    if (!base || !key || !secret) return null;
    return { base, key, secret };
  } catch {
    return null;
  }
}

async function getOrCreateCart(ctx: ToolContext): Promise<string> {
  const sb = createSupabaseServiceClient();
  if (ctx.conversationId) {
    const { data } = await sb
      .from('chat_carts')
      .select('id')
      .eq('company_id', ctx.companyId)
      .eq('conversation_id', ctx.conversationId)
      .eq('status', 'open')
      .maybeSingle();
    if (data) return data.id as string;
  }
  const { data } = await sb
    .from('chat_carts')
    .insert({ company_id: ctx.companyId, conversation_id: ctx.conversationId, status: 'open' })
    .select('id')
    .single();
  return data!.id as string;
}

export const createCart: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: { name: 'create_cart', description: 'Start a new cart for the conversation.', parameters: { type: 'object', properties: {} } },
  async execute(_input, ctx) {
    return { cart_id: await getOrCreateCart(ctx) };
  },
};

export const addToCart: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'add_to_cart',
    description:
      'Add a product or menu item to the cart. For restaurant items, all REQUIRED modifier groups must be satisfied or this returns an error listing what is missing. Price is computed by the backend.',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        quantity: { type: 'number' },
        modifier_ids: { type: 'array', items: { type: 'string' }, description: 'Selected modifier ids' },
      },
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const quantity = Math.max(1, num(input, 'quantity', 1));
    const productId = str(input, 'product_id');
    const menuItemId = str(input, 'menu_item_id');
    const modifierIds = Array.isArray(input.modifier_ids) ? input.modifier_ids.map(String) : [];

    let title = '';
    let unitPrice = 0;

    if (menuItemId) {
      const { data: item } = await sb
        .from('restaurant_menu_items')
        .select('name,base_price,is_available')
        .eq('company_id', ctx.companyId)
        .eq('id', menuItemId)
        .maybeSingle();
      if (!item) return { added: false, error: 'Menu item not found.' };
      if (!(item as { is_available?: boolean }).is_available) return { added: false, error: 'Item is unavailable.' };
      title = (item as { name: string }).name;
      unitPrice = Number((item as { base_price?: number }).base_price ?? 0);

      // Enforce required modifier groups.
      const { data: links } = await sb
        .from('menu_item_modifier_groups')
        .select('modifier_group_id')
        .eq('menu_item_id', menuItemId);
      const groupIds = (links ?? []).map((l) => (l as { modifier_group_id: string }).modifier_group_id);
      if (groupIds.length) {
        const { data: groups } = await sb
          .from('modifier_groups')
          .select('id,name,is_required,min_select')
          .in('id', groupIds);
        const { data: chosen } = await sb
          .from('modifiers')
          .select('id,modifier_group_id,price')
          .in('id', modifierIds.length ? modifierIds : ['00000000-0000-0000-0000-000000000000']);
        const chosenGroups = new Set((chosen ?? []).map((m) => (m as { modifier_group_id: string }).modifier_group_id));
        const missing = (groups ?? [])
          .filter((g) => (g as { is_required?: boolean }).is_required && !chosenGroups.has((g as { id: string }).id))
          .map((g) => (g as { name: string }).name);
        if (missing.length) {
          return { added: false, error: 'Missing required choices', required: missing };
        }
        unitPrice += (chosen ?? []).reduce((s, m) => s + Number((m as { price?: number }).price ?? 0), 0);
      }
    } else if (productId) {
      const { data: product } = await sb
        .from('synced_products')
        .select('title,price')
        .eq('company_id', ctx.companyId)
        .eq('id', productId)
        .maybeSingle();
      if (!product) return { added: false, error: 'Product not found.' };
      title = (product as { title: string }).title;
      unitPrice = Number((product as { price?: number }).price ?? 0);

      // Stock guard: when inventory is tracked for this product, never let the
      // cart exceed what's available. The backend is the source of truth — the
      // AI must not sell out-of-stock items.
      const { data: inv } = await sb
        .from('synced_inventory')
        .select('quantity')
        .eq('company_id', ctx.companyId)
        .eq('product_id', productId);
      if (inv && inv.length > 0) {
        const available = inv.reduce(
          (s, r) => s + Number((r as { quantity?: number }).quantity ?? 0),
          0,
        );
        const { data: existing } = await sb
          .from('chat_cart_items')
          .select('quantity')
          .eq('cart_id', cartId)
          .eq('product_id', productId);
        const inCart = (existing ?? []).reduce(
          (s, r) => s + Number((r as { quantity?: number }).quantity ?? 0),
          0,
        );
        if (inCart + quantity > available) {
          return { added: false, error: 'Not enough stock.', available, in_cart: inCart };
        }
      }
    } else {
      return { added: false, error: 'Provide product_id or menu_item_id.' };
    }

    const lineTotal = unitPrice * quantity;
    await sb.from('chat_cart_items').insert({
      company_id: ctx.companyId,
      cart_id: cartId,
      product_id: productId || null,
      menu_item_id: menuItemId || null,
      title,
      quantity,
      unit_price: unitPrice,
      options_json: { modifier_ids: modifierIds },
      line_total: lineTotal,
    });
    const subtotal = await recomputeCart(cartId);
    return { added: true, cart_id: cartId, title, unit_price: unitPrice, line_total: lineTotal, subtotal };
  },
};

export const calculateTotal: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: { name: 'calculate_total', description: 'Recompute and return the cart contents and subtotal.', parameters: { type: 'object', properties: {} } },
  async execute(_input, ctx) {
    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const { data: items } = await sb
      .from('chat_cart_items')
      .select('title,quantity,unit_price,line_total')
      .eq('cart_id', cartId);
    const subtotal = await recomputeCart(cartId);
    return { cart_id: cartId, items: items ?? [], subtotal };
  },
};

export const createOrder: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'create_order',
    description:
      'Create the order from the current cart. ONLY call after showing a summary and getting explicit customer confirmation. Requires customer name + a contact.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        customer_email: { type: 'string' },
        order_type: { type: 'string', enum: ['internal', 'cod', 'payment_link'] },
        confirmed: { type: 'boolean', description: 'Must be true — the customer explicitly confirmed.' },
      },
      required: ['customer_name', 'confirmed'],
    },
  },
  async execute(input, ctx) {
    if (input.confirmed !== true) return { created: false, error: 'Customer confirmation required.' };
    const customerPhone = str(input, 'customer_phone');
    const customerEmail = str(input, 'customer_email');
    if (!customerPhone && !customerEmail) {
      return { created: false, error: 'Customer phone or email is required before creating an order.' };
    }
    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const subtotal = await recomputeCart(cartId);
    const { data: items } = await sb.from('chat_cart_items').select('*').eq('cart_id', cartId);
    if (!items || items.length === 0) return { created: false, error: 'Cart is empty.' };

    const { data: order } = await sb
      .from('chat_orders')
      .insert({
        company_id: ctx.companyId,
        conversation_id: ctx.conversationId,
        cart_id: cartId,
        order_type: (str(input, 'order_type') || 'internal') as string,
        status: 'confirmed',
        customer_name: str(input, 'customer_name'),
        customer_phone: customerPhone || null,
        customer_email: customerEmail || null,
        total: subtotal,
      })
      .select('id')
      .single();

    await sb.from('chat_order_items').insert(
      items.map((it) => {
        const x = it as Record<string, unknown>;
        return {
          company_id: ctx.companyId,
          order_id: order!.id,
          title: x.title,
          quantity: x.quantity,
          unit_price: x.unit_price,
          line_total: x.line_total,
          options_json: x.options_json ?? {},
        };
      }),
    );
    await sb.from('chat_carts').update({ status: 'ordered' }).eq('id', cartId);
    await notify({
      companyId: ctx.companyId,
      type: 'new_order',
      title: 'New order placed via chat',
      body: `${str(input, 'customer_name')} — total ${subtotal}`,
      email: true,
    });
    return { created: true, order_id: order!.id, total: subtotal };
  },
};

export const createPaymentLink: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'create_payment_link',
    description: 'Create a Stripe payment link for an existing chat order id.',
    parameters: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] },
  },
  async execute(input, ctx) {
    const e = serverEnv();
    const sb = createSupabaseServiceClient();
    const orderId = str(input, 'order_id');
    const { data: order } = await sb
      .from('chat_orders')
      .select('total,currency')
      .eq('company_id', ctx.companyId)
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return { ok: false, error: 'Order not found.' };
    if (!e.STRIPE_SECRET_KEY) return { ok: false, error: 'Payments not configured.' };

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${publicEnv.NEXT_PUBLIC_APP_URL}/pay/success`);
    params.set('cancel_url', `${publicEnv.NEXT_PUBLIC_APP_URL}/pay/cancel`);
    params.set('line_items[0][price_data][currency]', String((order as { currency?: string }).currency ?? 'usd').toLowerCase());
    params.set('line_items[0][price_data][product_data][name]', `Order ${orderId.slice(0, 8)}`);
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(Number((order as { total?: number }).total ?? 0) * 100)));
    params.set('line_items[0][quantity]', '1');

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${e.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) return { ok: false, error: 'Could not create payment link.' };
    const session = await res.json();
    await sb.from('payments').insert({
      company_id: ctx.companyId,
      order_id: orderId,
      provider: 'stripe',
      status: 'pending',
      amount: Number((order as { total?: number }).total ?? 0),
      payment_url: session.url,
      external_ref: session.id,
    });
    return { ok: true, payment_url: session.url };
  },
};

export const updateCartItem: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'update_cart_item',
    description:
      'Change the quantity of an item already in the cart. Quantity 0 removes it. Identify the item by product_id or menu_item_id (the same id used to add it).',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        menu_item_id: { type: 'string' },
        quantity: { type: 'number' },
      },
      required: ['quantity'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const productId = str(input, 'product_id');
    const menuItemId = str(input, 'menu_item_id');
    const quantity = Math.max(0, Math.floor(num(input, 'quantity', 1)));
    if (!productId && !menuItemId) {
      return { updated: false, error: 'Provide product_id or menu_item_id.' };
    }

    let sel = sb
      .from('chat_cart_items')
      .select('id,unit_price')
      .eq('cart_id', cartId)
      .eq('company_id', ctx.companyId);
    sel = productId ? sel.eq('product_id', productId) : sel.eq('menu_item_id', menuItemId);
    const { data: rows } = await sel.limit(1);
    const row = (rows ?? [])[0] as { id: string; unit_price?: number } | undefined;
    if (!row) return { updated: false, error: 'Item not in cart.' };

    if (quantity === 0) {
      await sb.from('chat_cart_items').delete().eq('id', row.id);
      const subtotal = await recomputeCart(cartId);
      return { updated: true, removed: true, cart_id: cartId, subtotal };
    }
    const unitPrice = Number(row.unit_price ?? 0);
    await sb
      .from('chat_cart_items')
      .update({ quantity, line_total: unitPrice * quantity })
      .eq('id', row.id);
    const subtotal = await recomputeCart(cartId);
    return { updated: true, cart_id: cartId, quantity, line_total: unitPrice * quantity, subtotal };
  },
};

export const removeFromCart: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'remove_from_cart',
    description:
      'Remove an item from the cart by product_id or menu_item_id (the same id used to add it).',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        menu_item_id: { type: 'string' },
      },
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const productId = str(input, 'product_id');
    const menuItemId = str(input, 'menu_item_id');
    if (!productId && !menuItemId) {
      return { removed: false, error: 'Provide product_id or menu_item_id.' };
    }
    let q = sb
      .from('chat_cart_items')
      .delete()
      .eq('cart_id', cartId)
      .eq('company_id', ctx.companyId);
    q = productId ? q.eq('product_id', productId) : q.eq('menu_item_id', menuItemId);
    const { error } = await q;
    if (error) return { removed: false, error: 'Could not remove item.' };
    const subtotal = await recomputeCart(cartId);
    return { removed: true, cart_id: cartId, subtotal };
  },
};

export const createWooCommerceOrder: AssistantTool = {
  capabilities: ORDER_CAPS,
  schema: {
    name: 'create_woocommerce_order',
    description:
      'Create a REAL order in the connected WooCommerce store from the current cart. ONLY call after showing a summary and getting explicit customer confirmation. Requires customer name + a contact (phone or email). Only products synced from WooCommerce can be ordered this way.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        customer_email: { type: 'string' },
        confirmed: {
          type: 'boolean',
          description: 'Must be true — the customer explicitly confirmed.',
        },
      },
      required: ['customer_name', 'confirmed'],
    },
  },
  async execute(input, ctx) {
    if (input.confirmed !== true) return { created: false, error: 'Customer confirmation required.' };
    const customerName = str(input, 'customer_name');
    const customerPhone = str(input, 'customer_phone');
    const customerEmail = str(input, 'customer_email');
    if (!customerPhone && !customerEmail) {
      return { created: false, error: 'Customer phone or email is required before creating an order.' };
    }
    const creds = await getWooCreds(ctx.companyId);
    if (!creds) return { created: false, error: 'WooCommerce is not connected for this business.' };

    const sb = createSupabaseServiceClient();
    const cartId = await getOrCreateCart(ctx);
    const subtotal = await recomputeCart(cartId);
    const { data: items } = await sb.from('chat_cart_items').select('*').eq('cart_id', cartId);
    if (!items || items.length === 0) return { created: false, error: 'Cart is empty.' };

    // Map cart products → WooCommerce product ids (synced_products.external_id).
    const productIds = items
      .map((i) => (i as { product_id?: string }).product_id)
      .filter(Boolean) as string[];
    const { data: synced } = await sb
      .from('synced_products')
      .select('id,external_id')
      .eq('company_id', ctx.companyId)
      .in('id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']);
    const extById = new Map(
      (synced ?? []).map((s) => [
        (s as { id: string }).id,
        (s as { external_id?: string }).external_id,
      ]),
    );

    const lineItems: Array<{ product_id: number; quantity: number }> = [];
    const unmapped: string[] = [];
    for (const it of items) {
      const x = it as { product_id?: string; title?: string; quantity?: number };
      const ext = x.product_id ? extById.get(x.product_id) : undefined;
      if (!ext) {
        unmapped.push(x.title ?? 'item');
        continue;
      }
      lineItems.push({ product_id: Number(ext), quantity: Number(x.quantity ?? 1) });
    }
    if (lineItems.length === 0) {
      return { created: false, error: 'No cart items are linked to WooCommerce products.', unmapped };
    }

    const [firstName, ...rest] = customerName.split(' ');
    const auth = Buffer.from(`${creds.key}:${creds.secret}`).toString('base64');
    const res = await fetch(`${creds.base}/wp-json/wc/v3/orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_method: 'cod',
        payment_method_title: 'Placed via chat assistant',
        set_paid: false,
        status: 'pending',
        billing: {
          first_name: firstName || customerName,
          last_name: rest.join(' '),
          email: customerEmail || undefined,
          phone: customerPhone || undefined,
        },
        line_items: lineItems,
      }),
    });
    if (!res.ok) return { created: false, error: `WooCommerce order failed (${res.status}).` };
    const wcOrder = (await res.json()) as { id?: number; total?: string; number?: string };

    // Mirror locally so the order shows in the inbox / orders page + notifications.
    const { data: order } = await sb
      .from('chat_orders')
      .insert({
        company_id: ctx.companyId,
        conversation_id: ctx.conversationId,
        cart_id: cartId,
        order_type: 'woocommerce',
        status: 'confirmed',
        customer_name: customerName,
        customer_phone: customerPhone || null,
        customer_email: customerEmail || null,
        total: Number(wcOrder.total ?? subtotal) || subtotal,
        external_ref: wcOrder.id ? String(wcOrder.id) : null,
      })
      .select('id')
      .single();

    await sb.from('chat_order_items').insert(
      items.map((it) => {
        const x = it as Record<string, unknown>;
        return {
          company_id: ctx.companyId,
          order_id: order!.id,
          title: x.title,
          quantity: x.quantity,
          unit_price: x.unit_price,
          line_total: x.line_total,
          options_json: x.options_json ?? {},
        };
      }),
    );
    await sb.from('chat_carts').update({ status: 'ordered' }).eq('id', cartId);
    await notify({
      companyId: ctx.companyId,
      type: 'new_order',
      title: 'New WooCommerce order via chat',
      body: `${customerName} — WooCommerce #${wcOrder.number ?? wcOrder.id ?? ''} — total ${wcOrder.total ?? subtotal}`,
      email: true,
    });
    return {
      created: true,
      order_id: order!.id,
      woocommerce_order_id: wcOrder.id,
      total: wcOrder.total ?? subtotal,
      ...(unmapped.length
        ? { warning: `Some items were not linked to WooCommerce and were skipped: ${unmapped.join(', ')}` }
        : {}),
    };
  },
};

export const cartTools = [
  createCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  calculateTotal,
  createOrder,
  createWooCommerceOrder,
  createPaymentLink,
];
