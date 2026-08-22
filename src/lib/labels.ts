/**
 * One name per concept.
 *
 * Before this file, raw database enums were rendered to users in twenty places
 * via `.replace(/_/g, ' ')`, which produced strings like "Ai active" and
 * "not audited", and each screen that wanted something better kept its own
 * private label map. The same stored value therefore appeared as "Website
 * assistant" on one page and "hybrid business assistant" on the next.
 *
 * Every user-visible enum render should go through `label()`.
 *
 * ## Why labels are keyed by audience
 *
 * The two panels are read by two different people and must NOT share one
 * watered-down vocabulary:
 *
 * - `company` — a shop owner. Plain, active, second person. They do not know
 *   what an "escalation", a "connector" or a "capability" is, and should never
 *   have to. Words like SLA, CSAT, index and token do not appear here.
 * - `admin` — the platform operator. Precision beats friendliness: someone
 *   configuring a provider or reading an audit trail needs the real term, and
 *   softening it would cost them accuracy.
 *
 * When a concept genuinely has one correct name for both (a language, a
 * platform name) both entries simply carry the same string.
 */

export type LabelAudience = 'company' | 'admin';

type LabelEntry = { company: string; admin: string };
type LabelMap = Record<string, LabelEntry>;

/** Both audiences use the same wording. */
function same(value: string): LabelEntry {
  return { company: value, admin: value };
}

// ---------------------------------------------------------------------------
// Assistants
// ---------------------------------------------------------------------------

const BOT_TYPE: LabelMap = {
  help_desk: { company: 'Support answers', admin: 'Help desk' },
  sales_agent: { company: 'Sales help', admin: 'Sales agent' },
  hybrid_business_assistant: { company: 'Website assistant', admin: 'Hybrid business assistant' },
  informational: { company: 'Information only', admin: 'Informational' },
  custom: same('Custom'),
};

const ASSISTANT_AUDIENCE: LabelMap = {
  // "bot" is gone from the company panel: the navigation already says
  // "Assistants" while the route still says /bots, and the customer should only
  // ever meet one of those two words.
  customer: { company: 'Website assistant', admin: 'Customer-facing assistant' },
  internal: { company: 'Staff assistant', admin: 'Internal help desk assistant' },
};

/**
 * What the assistant can help with (the company panel's name for capabilities).
 *
 * These are the short names. The longer "what the customer gets" sentences live
 * next to the checkboxes in `bot-form.tsx`, because they are form help text
 * rather than labels.
 */
const CAPABILITY: LabelMap = {
  help_desk: { company: 'Answer support questions', admin: 'Help desk' },
  sales_agent: { company: 'Recommend products and services', admin: 'Sales agent' },
  lead_capture: { company: 'Collect enquiries', admin: 'Lead capture' },
  appointment_booking: { company: 'Take bookings', admin: 'Appointment booking' },
  product_stock_assistant: { company: 'Answer price and stock questions', admin: 'Product & stock assistant' },
  order_tracking: { company: 'Track orders', admin: 'Order tracking' },
  order_placement: { company: 'Place orders', admin: 'Order placement' },
  human_agent_takeover: { company: 'Pass the chat to a person', admin: 'Human agent takeover' },
  live_chat: { company: 'Let your team reply live', admin: 'Live chat' },
  internal_process_guide: { company: 'Explain how your business does things', admin: 'Internal process guide' },
  internal_products_read: { company: 'Look up products and prices', admin: 'Internal products (read)' },
  internal_stock_read: { company: 'Check stock levels', admin: 'Internal stock (read)' },
  internal_stock_update: { company: 'Update stock, with confirmation', admin: 'Internal stock (write)' },
  internal_orders_read: { company: 'Find orders', admin: 'Internal orders (read)' },
  internal_customers_read: { company: 'Find customer records', admin: 'Internal customers (read)' },
  internal_leads_read: { company: 'Review enquiries and bookings', admin: 'Internal leads (read)' },
};

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const CONVERSATION_STATUS: LabelMap = {
  // "ai_active" rendered as "Ai active" in at least two places.
  ai_active: { company: 'Assistant is replying', admin: 'AI active' },
  needs_human: { company: 'Waiting for your team', admin: 'Needs human' },
  human_active: { company: 'Your team is replying', admin: 'Human active' },
  closed: same('Closed'),
  expired: { company: 'Timed out', admin: 'Expired' },
};

const CHANNEL: LabelMap = {
  web_chat: { company: 'Website chat', admin: 'Web chat' },
  voice: same('Voice'),
  whatsapp: same('WhatsApp'),
  instagram: same('Instagram'),
  facebook: same('Facebook'),
  phone: same('Phone'),
  api: { company: 'Your own software', admin: 'API' },
};

const SEVERITY: LabelMap = {
  low: same('Low'),
  normal: same('Normal'),
  high: same('High'),
  urgent: same('Urgent'),
};

// ---------------------------------------------------------------------------
// Quality (super-admin only surface, but rendered from shared data)
// ---------------------------------------------------------------------------

const QUALITY_STATUS: LabelMap = {
  // Rendered as "not audited" — lowercase, mid-sentence — on the company detail
  // screen.
  not_audited: { company: 'Not reviewed yet', admin: 'Not audited' },
  passed: { company: 'Looks good', admin: 'Passed' },
  failed: { company: 'Needs attention', admin: 'Failed' },
  pending: { company: 'Being reviewed', admin: 'Pending' },
};

// ---------------------------------------------------------------------------
// The link to your shop system (the company panel's name for a connector)
// ---------------------------------------------------------------------------

const CONNECTOR_PLATFORM: LabelMap = {
  dotnet: same('.NET'),
  android: same('Android'),
  web: same('Web'),
  node: same('Node'),
  laravel: same('Laravel'),
  react: same('React'),
  vue: same('Vue'),
  fullstack: { company: 'Full web stack', admin: 'Fullstack' },
};

const CONNECTOR_STATUS: LabelMap = {
  active: { company: 'Working', admin: 'Active' },
  draft: { company: 'Not finished', admin: 'Draft' },
  revoked: { company: 'Turned off', admin: 'Revoked' },
  pending: { company: 'Waiting to connect', admin: 'Pending' },
};

const CONNECTION_STATE: LabelMap = {
  connected: { company: 'Online', admin: 'Connected' },
  disconnected: { company: 'Offline', admin: 'Disconnected' },
  degraded: { company: 'Having trouble', admin: 'Degraded' },
  unknown: { company: 'Not checked yet', admin: 'Unknown' },
};

const DELIVERY_MODE: LabelMap = {
  websocket: { company: 'Instant', admin: 'WebSocket' },
  polling: { company: 'Checks regularly', admin: 'Polling' },
  unknown: { company: 'Not checked yet', admin: 'Unknown' },
};

/** Synced screen documents awaiting review. "indexed" → "saved". */
const DOCUMENT_STATUS: LabelMap = {
  draft: { company: 'Waiting for your review', admin: 'Draft' },
  approved: { company: 'Approved', admin: 'Approved' },
  rejected: { company: 'Not used', admin: 'Rejected' },
  indexed: { company: 'Saved', admin: 'Indexed' },
};

const EVENT_STATUS: LabelMap = {
  queued: { company: 'Waiting to run', admin: 'Queued' },
  running: { company: 'Running now', admin: 'Running' },
  completed: { company: 'Done', admin: 'Completed' },
  failed: { company: "Didn't work", admin: 'Failed' },
  cancelled: { company: 'Stopped', admin: 'Cancelled' },
};

const ACTION_RISK: LabelMap = {
  low: { company: 'Safe', admin: 'Low risk' },
  medium: { company: 'Changes data', admin: 'Medium risk' },
  high: { company: 'Needs your confirmation', admin: 'High risk' },
};

const LANGUAGE: LabelMap = {
  en: same('English'),
  ar: same('Arabic'),
  auto: { company: 'Match the customer', admin: 'Auto-detect' },
};

const ROLE: LabelMap = {
  super_admin: same('Super admin'),
  company_admin: { company: 'Owner', admin: 'Company admin' },
  agent: { company: 'Team member', admin: 'Agent' },
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const DOMAINS = {
  botType: BOT_TYPE,
  assistantAudience: ASSISTANT_AUDIENCE,
  capability: CAPABILITY,
  conversationStatus: CONVERSATION_STATUS,
  channel: CHANNEL,
  severity: SEVERITY,
  qualityStatus: QUALITY_STATUS,
  connectorPlatform: CONNECTOR_PLATFORM,
  connectorStatus: CONNECTOR_STATUS,
  connectionState: CONNECTION_STATE,
  deliveryMode: DELIVERY_MODE,
  documentStatus: DOCUMENT_STATUS,
  eventStatus: EVENT_STATUS,
  actionRisk: ACTION_RISK,
  language: LANGUAGE,
  role: ROLE,
} satisfies Record<string, LabelMap>;

export type LabelDomain = keyof typeof DOMAINS;

/**
 * Last-resort formatting for a value no map covers yet.
 *
 * This is deliberately the only surviving underscore-stripper in the UI. It
 * sentence-cases rather than title-cases, so an unmapped value degrades to
 * "Not audited" instead of the old "not audited"/"Ai active" pair — and it
 * respects the handful of acronyms that must stay upper-case.
 */
const ACRONYMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  sms: 'SMS',
  url: 'URL',
  id: 'ID',
  pos: 'POS',
  faq: 'FAQ',
};

export function humanizeEnum(value: string): string {
  const words = value.trim().split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return value;
  return words
    .map((word, index) => {
      const acronym = ACRONYMS[word.toLowerCase()];
      if (acronym) return acronym;
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return word.toLowerCase();
    })
    .join(' ');
}

/**
 * Render a stored enum value for a human.
 *
 * @param domain   which set of values this belongs to
 * @param value    the raw database value (null/undefined tolerated)
 * @param audience 'company' for the shop owner's panel, 'admin' for the operator's
 */
export function label(
  domain: LabelDomain,
  value: string | null | undefined,
  audience: LabelAudience,
): string {
  if (!value) return '';
  const entry = DOMAINS[domain][value];
  return entry ? entry[audience] : humanizeEnum(value);
}

/** Convenience wrappers, so call sites read as prose. */
export function companyLabel(domain: LabelDomain, value: string | null | undefined): string {
  return label(domain, value, 'company');
}

export function adminLabel(domain: LabelDomain, value: string | null | undefined): string {
  return label(domain, value, 'admin');
}
