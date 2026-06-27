import { createSupabaseServiceClient } from '@/lib/db/server';
import type { AssistantTool, ToolContext } from './types';
import { str } from './types';

/**
 * Presenter tools (smart chat actions). Instead of interrogating the visitor
 * field-by-field, the model calls one of these to render a real UI element in
 * the widget — a lead/appointment/handoff form, suggested quick replies, or
 * product cards. Each returns a `__action` marker that the tool loop forwards
 * to the chat stream as a `{ type: 'action' }` SSE event. Product/stock data is
 * always read from the structured tables — never invented.
 */

interface SeededAction {
  id: string;
  label: string | null;
  description: string | null;
  form_schema_json: unknown;
  action_config_json: { defaultKey?: string } | null;
}

/**
 * Find the bot's configured quick-action row for a form intent, preferring the
 * seeded default (matched by defaultKey) but falling back to any active row of
 * the same action type the company may have created.
 */
async function resolveAction(
  ctx: ToolContext,
  actionType: string,
  defaultKey: string,
): Promise<SeededAction | null> {
  if (!ctx.botId) return null;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bot_quick_actions')
    .select('id,label,description,form_schema_json,action_config_json')
    .eq('company_id', ctx.companyId)
    .or(`bot_id.eq.${ctx.botId},bot_id.is.null`)
    .eq('action_type', actionType)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  const rows = (data ?? []) as SeededAction[];
  if (rows.length === 0) return null;
  return rows.find((r) => r.action_config_json?.defaultKey === defaultKey) ?? rows[0] ?? null;
}

/** Build a form presenter tool that resolves a seeded action and emits it. */
function formPresenter(opts: {
  name: string;
  description: string;
  capabilities: string[];
  actionType: string;
  defaultKey: string;
  uiAction: string;
  fallbackNote: string;
}): AssistantTool {
  return {
    capabilities: opts.capabilities,
    schema: {
      name: opts.name,
      description: opts.description,
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason the form is being shown.' },
        },
      },
    },
    async execute(input, ctx) {
      const action = await resolveAction(ctx, opts.actionType, opts.defaultKey);
      if (!action) {
        return { shown: false, note: opts.fallbackNote };
      }
      const fields = Array.isArray(action.form_schema_json) ? action.form_schema_json : [];
      return {
        shown: true,
        note: 'The form is now visible to the visitor. Tell them in one short line to fill it in — do NOT ask for the fields one by one.',
        __action: {
          action: opts.uiAction,
          payload: {
            actionId: action.id,
            title: action.label,
            description: action.description,
            fields,
            reason: str(input, 'reason') || null,
          },
        },
      };
    },
  };
}

export const showLeadForm = formPresenter({
  name: 'show_lead_form',
  description:
    'Show an inline lead-capture form in the chat. Use when the visitor wants a quote, a callback, pricing, or to be contacted, instead of asking for their name/phone/email one at a time.',
  capabilities: ['lead_capture', 'sales_agent'],
  actionType: 'lead_form',
  defaultKey: 'lead_form',
  uiAction: 'lead_form',
  fallbackNote:
    'No lead form is configured. Collect the name and at least one contact (email or phone) in chat, then call capture_lead.',
});

export const showAppointmentForm = formPresenter({
  name: 'show_appointment_form',
  description:
    'Show an inline appointment-request form in the chat. Use when the visitor wants to book, schedule, or reserve a time. Never tell the visitor an appointment is confirmed unless a tool confirms it.',
  capabilities: ['appointment_booking'],
  actionType: 'appointment_form',
  defaultKey: 'appointment_form',
  uiAction: 'appointment_form',
  fallbackNote:
    'No appointment form is configured. Collect name, a contact, the service, and a preferred date/time in chat, then call request_appointment.',
});

export const showHandoffForm = formPresenter({
  name: 'show_handoff_form',
  description:
    'Show an inline human-handoff form so the visitor can leave their contact details for a team member. Use when the visitor asks for a human/agent or when you cannot help.',
  capabilities: ['human_agent_takeover', 'live_chat'],
  actionType: 'request_human',
  defaultKey: 'human_handoff',
  uiAction: 'human_handoff',
  fallbackNote:
    'No handoff form is configured. Acknowledge the request and let the visitor know the team will follow up.',
});

export const showQuickReplies: AssistantTool = {
  capabilities: ['lead_capture', 'sales_agent', 'help_desk', 'appointment_booking', 'product_stock_assistant', 'order_tracking', 'human_agent_takeover'],
  schema: {
    name: 'show_quick_replies',
    description:
      'Offer the visitor 2–5 tappable suggested replies to keep the conversation moving (e.g. common next questions). Each option is sent as the visitor\'s next message when tapped.',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2 to 5 short reply suggestions.',
        },
      },
      required: ['options'],
    },
  },
  async execute(input) {
    const raw = (input as { options?: unknown }).options;
    const options = Array.isArray(raw)
      ? raw.map((o) => String(o).trim()).filter(Boolean).slice(0, 5)
      : [];
    if (options.length === 0) return { shown: false, note: 'Provide 2-5 reply options.' };
    return {
      shown: true,
      note: 'Quick replies are shown to the visitor.',
      __action: { action: 'quick_replies', payload: { options } },
    };
  },
};

export const showProductCards: AssistantTool = {
  capabilities: ['product_stock_assistant', 'sales_agent', 'order_placement'],
  schema: {
    name: 'show_product_cards',
    description:
      'Display matching products as visual cards (name, price, currency, stock, SKU). Use when the visitor wants to see/browse products. Prices and stock come from the catalogue — never invent them.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keywords.' } },
      required: ['query'],
    },
  },
  async execute(input, ctx) {
    const sb = createSupabaseServiceClient();
    const q = str(input, 'query');
    const safe = q.replace(/[(),]/g, ' ').trim();
    const { data: products } = await sb
      .from('synced_products')
      .select('id,title,description,price,currency,sku,status')
      .eq('company_id', ctx.companyId)
      .or(`title.ilike.%${safe}%,description.ilike.%${safe}%,category.ilike.%${safe}%,sku.ilike.%${safe}%`)
      .limit(6);
    const rows = (products ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      price: number | null;
      currency: string | null;
      sku: string | null;
      status: string | null;
    }>;
    if (rows.length === 0) {
      return { shown: false, note: 'No matching products found. Tell the visitor and offer to capture a lead.' };
    }

    // Stock per product from the structured inventory table (summed).
    const ids = rows.map((r) => r.id);
    const { data: inv } = await sb
      .from('synced_inventory')
      .select('product_id,quantity,in_stock')
      .eq('company_id', ctx.companyId)
      .in('product_id', ids);
    const stockByProduct = new Map<string, boolean>();
    for (const r of (inv ?? []) as Array<{ product_id: string; quantity: number | null; in_stock: boolean | null }>) {
      const cur = stockByProduct.get(r.product_id) || false;
      stockByProduct.set(r.product_id, cur || Boolean(r.in_stock) || (r.quantity ?? 0) > 0);
    }

    const cards = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ? String(r.description).slice(0, 140) : null,
      price: r.price,
      currency: r.currency,
      sku: r.sku,
      // null = no inventory record synced → widget shows "Confirm with team".
      inStock: stockByProduct.has(r.id) ? stockByProduct.get(r.id)! : null,
    }));

    return {
      shown: true,
      count: cards.length,
      note: 'Product cards are shown to the visitor with live price and stock.',
      __action: { action: 'product_cards', payload: { products: cards } },
    };
  },
};

export const presenterTools = [
  showLeadForm,
  showAppointmentForm,
  showHandoffForm,
  showQuickReplies,
  showProductCards,
];
