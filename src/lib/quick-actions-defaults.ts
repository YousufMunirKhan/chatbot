import { createSupabaseServiceClient } from '@/lib/db/server';
import type {
  QuickActionAudience,
  QuickActionContextMode,
  QuickActionField,
  QuickActionSource,
  QuickActionType,
} from '@/lib/quick-actions';

/**
 * Default in-chat quick actions seeded per bot based on capabilities and
 * audience. These are ordinary `bot_quick_actions` rows: companies can rename,
 * edit, reorder, or disable them. Seeding is idempotent and never overwrites
 * company edits except for a small legacy-label refresh path.
 */
export interface DefaultQuickAction {
  /** Stable key used to find/refresh this default and resolve presenter tools. */
  defaultKey: string;
  audience: QuickActionAudience;
  source?: QuickActionSource;
  contextMode?: QuickActionContextMode;
  /** Any of these capabilities being enabled seeds this action. */
  enabledBy: string[];
  label: string;
  description: string;
  actionType: QuickActionType;
  actionConfig?: Record<string, unknown>;
  formSchema: QuickActionField[];
}

export const CUSTOMER_DEFAULT_QUICK_ACTIONS: DefaultQuickAction[] = [
  {
    defaultKey: 'lead_form',
    audience: 'customer',
    enabledBy: ['lead_capture', 'sales_agent'],
    label: 'Get pricing',
    description: 'Tell us what you need and our team will send the right quote.',
    actionType: 'lead_form',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'What do you need?', type: 'text' },
      { name: 'message', label: 'Anything else we should know?', type: 'textarea' },
    ],
  },
  {
    defaultKey: 'appointment_form',
    audience: 'customer',
    enabledBy: ['appointment_booking'],
    label: 'Book a free demo',
    description: 'Request a date and time - we will confirm with you.',
    actionType: 'appointment_form',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'What would you like to discuss?', type: 'text' },
      { name: 'date', label: 'Preferred date', type: 'date' },
      { name: 'time', label: 'Preferred time', type: 'time' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    defaultKey: 'human_handoff',
    audience: 'customer',
    enabledBy: ['human_agent_takeover', 'live_chat'],
    label: 'Talk to the team',
    description: 'Share the best way to reach you and our team will take over.',
    actionType: 'request_human',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'contact', label: 'Phone or email', type: 'text', required: true },
      { name: 'message', label: 'How can we help?', type: 'textarea' },
    ],
  },
  {
    defaultKey: 'track_order',
    audience: 'customer',
    enabledBy: ['order_tracking'],
    label: 'Track my order',
    description: 'Check an order using your order number and contact detail.',
    actionType: 'send_message',
    actionConfig: { message_text: 'I want to track my order' },
    formSchema: [],
  },
  {
    defaultKey: 'browse_products',
    audience: 'customer',
    enabledBy: ['product_stock_assistant', 'sales_agent', 'order_placement'],
    label: 'Browse products',
    description: 'See products, prices, and availability.',
    actionType: 'send_message',
    actionConfig: { message_text: 'Show me your products' },
    formSchema: [],
  },
];

export const HELPDESK_DEFAULT_QUICK_ACTIONS: DefaultQuickAction[] = [
  {
    defaultKey: 'helpdesk_add_product',
    audience: 'internal',
    enabledBy: ['help_desk', 'internal_process_guide', 'internal_products_read'],
    label: 'How do I add product?',
    description: 'Show the steps and menu path for adding a product.',
    actionType: 'send_message',
    actionConfig: { message_text: 'How do I add a new product?' },
    formSchema: [],
  },
  {
    defaultKey: 'helpdesk_check_stock',
    audience: 'internal',
    contextMode: 'action',
    enabledBy: ['help_desk', 'internal_stock_read'],
    label: 'Check stock',
    description: 'Search product stock through an approved connector action.',
    actionType: 'send_message',
    actionConfig: { message_text: 'Check stock for a product' },
    formSchema: [],
  },
  {
    defaultKey: 'helpdesk_update_price',
    audience: 'internal',
    contextMode: 'action',
    enabledBy: ['help_desk', 'internal_products_read', 'internal_stock_update'],
    label: 'Update product price',
    description: 'Start a confirmed price update flow.',
    actionType: 'send_message',
    actionConfig: { message_text: 'I want to update a product price' },
    formSchema: [],
  },
  {
    defaultKey: 'helpdesk_purchase_order',
    audience: 'internal',
    contextMode: 'navigation',
    enabledBy: ['help_desk', 'internal_process_guide', 'internal_orders_read'],
    label: 'Create purchase order',
    description: 'Show the purchase order screen path and steps.',
    actionType: 'send_message',
    actionConfig: { message_text: 'How do I create a purchase order?' },
    formSchema: [],
  },
  {
    defaultKey: 'helpdesk_daily_sales',
    audience: 'internal',
    contextMode: 'action',
    enabledBy: ['help_desk', 'internal_process_guide'],
    label: 'Daily sales report',
    description: 'Open or run the daily sales report flow.',
    actionType: 'send_message',
    actionConfig: { message_text: 'Show daily sales report' },
    formSchema: [],
  },
  {
    defaultKey: 'helpdesk_low_stock',
    audience: 'internal',
    contextMode: 'action',
    enabledBy: ['help_desk', 'internal_stock_read'],
    label: 'Low stock products',
    description: 'Find low-stock products through the connector.',
    actionType: 'send_message',
    actionConfig: { message_text: 'Show low stock products' },
    formSchema: [],
  },
];

export const DEFAULT_QUICK_ACTIONS: DefaultQuickAction[] = [
  ...CUSTOMER_DEFAULT_QUICK_ACTIONS,
  ...HELPDESK_DEFAULT_QUICK_ACTIONS,
];

const LEGACY_DEFAULT_LABELS: Record<string, string[]> = {
  lead_form: ['Get a quote', 'Get EPOS pricing'],
  appointment_form: ['Book appointment'],
  human_handoff: ['Talk to a human'],
};

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Defaults whose enabling capability is present in the bot's flags and audience. */
export function defaultsForCapabilities(
  capabilities: string[],
  audience: QuickActionAudience = 'customer',
): DefaultQuickAction[] {
  const caps = new Set(capabilities);
  return DEFAULT_QUICK_ACTIONS.filter(
    (d) => (d.audience === audience || d.audience === 'both') && d.enabledBy.some((c) => caps.has(c)),
  );
}

/**
 * Seed any missing default quick actions for a bot. Safe to call on every bot
 * create/update: it never duplicates rows and does not clobber edited defaults.
 */
export async function seedDefaultQuickActions(
  sb: ServiceClient,
  companyId: string,
  botId: string,
  capabilities: string[],
  audience: QuickActionAudience = 'customer',
  enabled = true,
): Promise<void> {
  try {
    if (!enabled) return;
    const wanted = defaultsForCapabilities(capabilities, audience);
    if (wanted.length === 0) return;

    const { data: existing } = await sb
      .from('bot_quick_actions')
      .select('id,label,action_config_json')
      .eq('company_id', companyId)
      .eq('bot_id', botId);

    const existingDefaults = new Map<
      string,
      { id: string; label: string; action_config_json?: { seeded?: unknown; defaultKey?: unknown } }
    >();
    for (const row of existing ?? []) {
      const r = row as {
        id?: string;
        label?: string;
        action_config_json?: { seeded?: unknown; defaultKey?: unknown };
      };
      const key = typeof r.action_config_json?.defaultKey === 'string' ? r.action_config_json.defaultKey : null;
      if (r.id && key) existingDefaults.set(key, { id: r.id, label: r.label ?? '', action_config_json: r.action_config_json });
    }
    const existingKeys = new Set(existingDefaults.keys());

    await Promise.all(
      wanted.map(async (d) => {
        const current = existingDefaults.get(d.defaultKey);
        const legacyLabels = LEGACY_DEFAULT_LABELS[d.defaultKey] ?? [];
        if (!current || current.action_config_json?.seeded !== true || !legacyLabels.includes(current.label)) return;
        await sb
          .from('bot_quick_actions')
          .update({
            label: d.label,
            description: d.description,
            action_type: d.actionType,
            action_config_json: { seeded: true, defaultKey: d.defaultKey, ...(d.actionConfig ?? {}) },
            form_schema_json: d.formSchema,
            audience: d.audience,
            source: d.source ?? 'default',
            context_mode: d.contextMode ?? 'initial',
          })
          .eq('company_id', companyId)
          .eq('bot_id', botId)
          .eq('id', current.id);
      }),
    );

    const rows = wanted
      .filter((d) => !existingKeys.has(d.defaultKey))
      .map((d, i) => ({
        company_id: companyId,
        bot_id: botId,
        label: d.label,
        description: d.description,
        action_type: d.actionType,
        action_config_json: { seeded: true, defaultKey: d.defaultKey, ...(d.actionConfig ?? {}) },
        form_schema_json: d.formSchema,
        audience: d.audience,
        source: d.source ?? 'default',
        context_mode: d.contextMode ?? 'initial',
        // Left empty on purpose: seeding is already capability-gated, and the
        // `required_capabilities` filter is AND-matched, which cannot express
        // the OR relationship in `enabledBy`.
        required_capabilities: [],
        priority: 50 + i,
        is_active: true,
        starts_new_message: true,
      }));

    if (rows.length > 0) {
      await sb.from('bot_quick_actions').insert(rows);
    }
  } catch {
    // Non-fatal: bot creation must succeed even if seeding fails.
  }
}
