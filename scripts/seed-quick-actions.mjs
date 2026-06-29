import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';

const customerDefaults = [
  {
    defaultKey: 'lead_form',
    enabledBy: ['lead_capture', 'sales_agent'],
    label: 'Get pricing',
    description: 'Tell us what you need and our team will send the right quote.',
    actionType: 'lead_form',
    actionConfig: {},
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'What do you need?', type: 'text' },
      { name: 'message', label: 'Anything else we should know?', type: 'textarea' },
    ],
    contextMode: 'initial',
  },
  {
    defaultKey: 'appointment_form',
    enabledBy: ['appointment_booking'],
    label: 'Book a free demo',
    description: 'Request a date and time - we will confirm with you.',
    actionType: 'appointment_form',
    actionConfig: {},
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'What would you like to discuss?', type: 'text' },
      { name: 'date', label: 'Preferred date', type: 'date' },
      { name: 'time', label: 'Preferred time', type: 'time' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    contextMode: 'initial',
  },
  {
    defaultKey: 'human_handoff',
    enabledBy: ['human_agent_takeover', 'live_chat'],
    label: 'Talk to the team',
    description: 'Share the best way to reach you and our team will take over.',
    actionType: 'request_human',
    actionConfig: {},
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'contact', label: 'Phone or email', type: 'text', required: true },
      { name: 'message', label: 'How can we help?', type: 'textarea' },
    ],
    contextMode: 'initial',
  },
  {
    defaultKey: 'track_order',
    enabledBy: ['order_tracking'],
    label: 'Track my order',
    description: 'Check an order using your order number and contact detail.',
    actionType: 'send_message',
    actionConfig: { message_text: 'I want to track my order' },
    formSchema: [],
    contextMode: 'initial',
  },
  {
    defaultKey: 'browse_products',
    enabledBy: ['product_stock_assistant', 'sales_agent', 'order_placement'],
    label: 'Browse products',
    description: 'See products, prices, and availability.',
    actionType: 'send_message',
    actionConfig: { message_text: 'Show me your products' },
    formSchema: [],
    contextMode: 'initial',
  },
];

const helpdeskDefaults = [
  ['helpdesk_add_product', ['help_desk', 'internal_process_guide', 'internal_products_read'], 'How do I add product?', 'Show the steps and menu path for adding a product.', 'How do I add a new product?', 'initial'],
  ['helpdesk_check_stock', ['help_desk', 'internal_stock_read'], 'Check stock', 'Search product stock through an approved connector action.', 'Check stock for a product', 'action'],
  ['helpdesk_update_price', ['help_desk', 'internal_products_read', 'internal_stock_update'], 'Update product price', 'Start a confirmed price update flow.', 'I want to update a product price', 'action'],
  ['helpdesk_purchase_order', ['help_desk', 'internal_process_guide', 'internal_orders_read'], 'Create purchase order', 'Show the purchase order screen path and steps.', 'How do I create a purchase order?', 'navigation'],
  ['helpdesk_daily_sales', ['help_desk', 'internal_process_guide'], 'Daily sales report', 'Open or run the daily sales report flow.', 'Show daily sales report', 'action'],
  ['helpdesk_low_stock', ['help_desk', 'internal_stock_read'], 'Low stock products', 'Find low-stock products through the connector.', 'Show low stock products', 'action'],
].map(([defaultKey, enabledBy, label, description, message, contextMode]) => ({
  defaultKey,
  enabledBy,
  label,
  description,
  actionType: 'send_message',
  actionConfig: { message_text: message },
  formSchema: [],
  contextMode,
}));

function isInternalBot(bot) {
  const appearance = bot.appearance_json && typeof bot.appearance_json === 'object' ? bot.appearance_json : {};
  const caps = Array.isArray(bot.capability_flags) ? bot.capability_flags : [];
  return (
    appearance.assistantAudience === 'internal' ||
    bot.bot_type === 'help_desk' ||
    caps.some((cap) => String(cap).startsWith('internal_'))
  );
}

function enabledDefaults(bot) {
  const audience = isInternalBot(bot) ? 'internal' : 'customer';
  const appearance = bot.appearance_json && typeof bot.appearance_json === 'object' ? bot.appearance_json : {};
  if (appearance.enableDefaultPills === false) return { audience, defaults: [] };
  const caps = new Set(Array.isArray(bot.capability_flags) ? bot.capability_flags : []);
  const list = audience === 'internal' ? helpdeskDefaults : customerDefaults;
  return { audience, defaults: list.filter((item) => item.enabledBy.some((cap) => caps.has(cap))) };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

let inserted = 0;
let tagged = 0;
try {
  const bots = await client.query('select id, company_id, bot_type, capability_flags, appearance_json from public.bots');
  for (const bot of bots.rows) {
    const { audience, defaults } = enabledDefaults(bot);
    if (!defaults.length) continue;
    const existing = await client.query(
      'select id, action_config_json from public.bot_quick_actions where company_id = $1 and bot_id = $2',
      [bot.company_id, bot.id],
    );
    const existingKeys = new Map();
    for (const row of existing.rows) {
      const key = row.action_config_json?.defaultKey;
      if (typeof key === 'string') existingKeys.set(key, row.id);
    }

    for (const item of defaults) {
      const config = { seeded: true, defaultKey: item.defaultKey, ...item.actionConfig };
      const currentId = existingKeys.get(item.defaultKey);
      if (currentId) {
        await client.query(
          "update public.bot_quick_actions set audience = $1, source = 'default', context_mode = $2 where id = $3 and company_id = $4",
          [audience, item.contextMode, currentId, bot.company_id],
        );
        tagged++;
        continue;
      }
      await client.query(
        `insert into public.bot_quick_actions
          (company_id, bot_id, label, description, action_type, action_config_json, form_schema_json, contexts,
           required_capabilities, priority, is_active, starts_new_message, audience, source, context_mode)
         values ($1,$2,$3,$4,$5,$6,$7,'{initial}', '{}', $8, true, true, $9, 'default', $10)`,
        [
          bot.company_id,
          bot.id,
          item.label,
          item.description,
          item.actionType,
          JSON.stringify(config),
          JSON.stringify(item.formSchema),
          50 + inserted,
          audience,
          item.contextMode,
        ],
      );
      inserted++;
    }
  }
} finally {
  await client.end();
}

console.log(`Quick action seeder complete. Inserted ${inserted}, tagged ${tagged}.`);
