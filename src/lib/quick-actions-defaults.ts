import { createSupabaseServiceClient } from '@/lib/db/server';
import type { QuickActionField, QuickActionType } from '@/lib/quick-actions';

/**
 * Default in-chat quick actions seeded per bot based on its capabilities.
 *
 * These are ordinary `bot_quick_actions` rows — the company can rename, edit the
 * fields, or switch them off in the admin UI. They power BOTH the quick-reply
 * buttons AND the forms the AI shows inline mid-conversation (presenter tools
 * resolve the seeded row by `action_config_json.defaultKey`). Seeding is
 * idempotent: a default is only inserted when no row with the same defaultKey
 * already exists for the bot, so re-enabling a capability never duplicates a row
 * or clobbers the company's edits.
 */
export interface DefaultQuickAction {
  /** Stable key used to find/refresh this default and to resolve it from presenter tools. */
  defaultKey: string;
  /** Any of these capabilities being enabled seeds this action. */
  enabledBy: string[];
  label: string;
  description: string;
  actionType: QuickActionType;
  formSchema: QuickActionField[];
}

export const DEFAULT_QUICK_ACTIONS: DefaultQuickAction[] = [
  {
    defaultKey: 'lead_form',
    enabledBy: ['lead_capture', 'sales_agent'],
    label: 'Get a quote',
    description: 'Leave your details and our team will get back to you.',
    actionType: 'lead_form',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'Service / product of interest', type: 'text' },
      { name: 'message', label: 'Message', type: 'textarea' },
    ],
  },
  {
    defaultKey: 'appointment_form',
    enabledBy: ['appointment_booking'],
    label: 'Book appointment',
    description: 'Request a date and time — we will confirm with you.',
    actionType: 'appointment_form',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'phone', label: 'Phone', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'service', label: 'Service', type: 'text' },
      { name: 'date', label: 'Preferred date', type: 'date' },
      { name: 'time', label: 'Preferred time', type: 'time' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    defaultKey: 'human_handoff',
    enabledBy: ['human_agent_takeover', 'live_chat'],
    label: 'Talk to a human',
    description: 'Share how to reach you and our team will take over.',
    actionType: 'request_human',
    formSchema: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'contact', label: 'Phone or email', type: 'text', required: true },
      { name: 'message', label: 'How can we help?', type: 'textarea' },
    ],
  },
];

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/** Defaults whose enabling capability is present in the bot's flags. */
export function defaultsForCapabilities(capabilities: string[]): DefaultQuickAction[] {
  const caps = new Set(capabilities);
  return DEFAULT_QUICK_ACTIONS.filter((d) => d.enabledBy.some((c) => caps.has(c)));
}

/**
 * Seed any missing default quick actions for a bot. Safe to call on every bot
 * create and update — it never duplicates rows or overwrites company edits.
 * Failures are swallowed so a seeding hiccup can never block bot creation.
 */
export async function seedDefaultQuickActions(
  sb: ServiceClient,
  companyId: string,
  botId: string,
  capabilities: string[],
): Promise<void> {
  try {
    const wanted = defaultsForCapabilities(capabilities);
    if (wanted.length === 0) return;

    const { data: existing } = await sb
      .from('bot_quick_actions')
      .select('action_config_json')
      .eq('company_id', companyId)
      .eq('bot_id', botId);

    const existingKeys = new Set(
      (existing ?? [])
        .map((r) => {
          const cfg = (r as { action_config_json?: { defaultKey?: unknown } }).action_config_json;
          return typeof cfg?.defaultKey === 'string' ? cfg.defaultKey : null;
        })
        .filter((k): k is string => Boolean(k)),
    );

    const rows = wanted
      .filter((d) => !existingKeys.has(d.defaultKey))
      .map((d, i) => ({
        company_id: companyId,
        bot_id: botId,
        label: d.label,
        description: d.description,
        action_type: d.actionType,
        action_config_json: { seeded: true, defaultKey: d.defaultKey },
        form_schema_json: d.formSchema,
        // Left empty on purpose: seeding is already capability-gated, and the
        // `required_capabilities` filter is AND-matched, which can't express the
        // OR relationship in `enabledBy`. Showing the button is harmless.
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
