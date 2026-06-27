import { createSupabaseServiceClient } from '@/lib/db/server';
import type { AssistantTool } from './types';
import { str } from './types';

/**
 * Product & stock + restaurant menu tools (Module 16). Prices and stock ALWAYS
 * come from the structured tables — the AI must not invent them.
 */
export const searchProducts: AssistantTool = {
  capabilities: ['product_stock_assistant', 'sales_agent', 'order_placement'],
  schema: {
    name: 'search_products',
    description: 'Search the catalogue for products by keyword. Returns title, price, currency, and stock.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keywords' } },
      required: ['query'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const q = str(input, 'query');
    const safe = q.replace(/[(),]/g, ' ').trim();
    const { data } = await sb
      .from('synced_products')
      .select('id,title,description,price,currency,sku,status')
      .eq('company_id', ctx.companyId)
      .or(`title.ilike.%${safe}%,description.ilike.%${safe}%,category.ilike.%${safe}%,sku.ilike.%${safe}%`)
      .limit(8);
    return { results: data ?? [] };
  },
};

export const getProductDetails: AssistantTool = {
  capabilities: ['product_stock_assistant', 'sales_agent', 'order_placement'],
  schema: {
    name: 'get_product_details',
    description: 'Get full details and variants for a product by id.',
    parameters: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const id = str(input, 'product_id');
    const { data: product } = await sb
      .from('synced_products')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('id', id)
      .maybeSingle();
    if (!product) return { found: false };
    const { data: variants } = await sb
      .from('synced_product_variants')
      .select('id,title,price,sku,options_json')
      .eq('product_id', id);
    return { found: true, product, variants: variants ?? [] };
  },
};

export const checkStock: AssistantTool = {
  capabilities: ['product_stock_assistant', 'order_placement'],
  schema: {
    name: 'check_stock',
    description: 'Check inventory/availability for a product id.',
    parameters: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const id = str(input, 'product_id');
    const { data } = await sb
      .from('synced_inventory')
      .select('quantity,in_stock,location')
      .eq('company_id', ctx.companyId)
      .eq('product_id', id);
    const total = (data ?? []).reduce((s, r) => s + ((r as { quantity?: number }).quantity ?? 0), 0);
    return { in_stock: total > 0, quantity: total, locations: data ?? [] };
  },
};

export const searchRestaurantMenu: AssistantTool = {
  capabilities: ['product_stock_assistant', 'order_placement', 'sales_agent'],
  schema: {
    name: 'search_restaurant_menu',
    description: 'Search the restaurant menu by keyword. Returns items with base price and availability.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const q = str(input, 'query');
    const { data } = await sb
      .from('restaurant_menu_items')
      .select('id,name,description,category,base_price,currency,is_available,allergy_notes')
      .eq('company_id', ctx.companyId)
      .ilike('name', `%${q}%`)
      .limit(8);
    return { results: data ?? [] };
  },
};

export const getMenuItemOptions: AssistantTool = {
  capabilities: ['product_stock_assistant', 'order_placement'],
  schema: {
    name: 'get_menu_item_options',
    description:
      'Get the required and optional modifier groups for a menu item. Use this BEFORE adding a restaurant item to a cart so all required choices are collected.',
    parameters: {
      type: 'object',
      properties: { menu_item_id: { type: 'string' } },
      required: ['menu_item_id'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const itemId = str(input, 'menu_item_id');
    const { data: links } = await sb
      .from('menu_item_modifier_groups')
      .select('modifier_group_id')
      .eq('company_id', ctx.companyId)
      .eq('menu_item_id', itemId);
    const groupIds = (links ?? []).map((l) => (l as { modifier_group_id: string }).modifier_group_id);
    if (groupIds.length === 0) return { variants: [], modifier_groups: [] };

    const { data: groups } = await sb
      .from('modifier_groups')
      .select('id,name,is_required,min_select,max_select')
      .in('id', groupIds);
    const { data: modifiers } = await sb
      .from('modifiers')
      .select('id,modifier_group_id,name,price,is_available')
      .in('modifier_group_id', groupIds);
    const { data: variants } = await sb
      .from('restaurant_menu_variants')
      .select('id,name,price')
      .eq('menu_item_id', itemId);

    return {
      variants: variants ?? [],
      modifier_groups: (groups ?? []).map((g) => ({
        ...(g as Record<string, unknown>),
        modifiers: (modifiers ?? []).filter(
          (m) => (m as { modifier_group_id: string }).modifier_group_id === (g as { id: string }).id,
        ),
      })),
    };
  },
};

export const checkItemAvailability: AssistantTool = {
  capabilities: ['product_stock_assistant', 'order_placement'],
  schema: {
    name: 'check_item_availability',
    description: 'Check whether a menu item is currently available.',
    parameters: {
      type: 'object',
      properties: { menu_item_id: { type: 'string' } },
      required: ['menu_item_id'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const id = str(input, 'menu_item_id');
    const { data } = await sb
      .from('restaurant_menu_items')
      .select('is_available,name')
      .eq('company_id', ctx.companyId)
      .eq('id', id)
      .maybeSingle();
    return { available: Boolean((data as { is_available?: boolean } | null)?.is_available) };
  },
};

export const productTools = [
  searchProducts,
  getProductDetails,
  checkStock,
  searchRestaurantMenu,
  getMenuItemOptions,
  checkItemAvailability,
];
