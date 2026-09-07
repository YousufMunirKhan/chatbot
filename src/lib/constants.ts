/** Platform-wide constants and enums shared across modules. */

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  COMPANY_ADMIN: 'company_admin',
  AGENT: 'agent',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const CHANNELS = [
  'web_chat',
  'voice',
  'whatsapp',
  'instagram',
  'facebook',
  'email',
  'telegram',
  'viber',
  'line',
  'tiktok',
  'youtube',
  'phone',
  'api',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Display names for the channels a customer can actually message on. */
export const CHANNEL_LABELS: Record<string, string> = {
  web_chat: 'Website chat',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  email: 'Email',
  telegram: 'Telegram',
  viber: 'Viber',
  line: 'LINE',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  phone: 'Phone',
  api: 'API',
};

export const CONTENT_TYPES = ['text', 'audio', 'image', 'file', 'system'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const BOT_TYPES = [
  'help_desk',
  'sales_agent',
  'hybrid_business_assistant',
  'informational',
  'custom',
] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const ASSISTANT_AUDIENCES = ['customer', 'internal'] as const;
export type AssistantAudience = (typeof ASSISTANT_AUDIENCES)[number];

export const BOT_CAPABILITIES = [
  'help_desk',
  'sales_agent',
  'lead_capture',
  'appointment_booking',
  'product_stock_assistant',
  'order_tracking',
  'order_placement',
  'human_agent_takeover',
  'live_chat',
  'internal_products_read',
  'internal_stock_read',
  'internal_stock_update',
  'internal_orders_read',
  'internal_customers_read',
  'internal_leads_read',
  'internal_process_guide',
] as const;
export type BotCapability = (typeof BOT_CAPABILITIES)[number];

export const CONVERSATION_STATUS = [
  'ai_active',
  'needs_human',
  'human_active',
  'closed',
  'expired',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[number];

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'auto'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Default retention for chat data (Module 23). Configurable per company later. */
export const DEFAULT_CHAT_RETENTION_DAYS = 30;

/* ---------------------------------------------------------------------------
 * Display labels
 *
 * Everything below is presentation only — no value here is ever stored, matched
 * or sent anywhere. They exist because a lot of screens were printing the stored
 * value straight into a badge: a shop owner was reading `wc-processing`,
 * `TIER_1K`, `doc_chunk` and `auth login_failed` and being expected to work out
 * what happened.
 *
 * Every map is a `Record<string, string>` rather than a `Record<Enum, string>`
 * on purpose: several of these values come back from someone else's API (Meta,
 * Shopify, WooCommerce) and can carry a status we have never seen. Pair each
 * lookup with `humanizeToken()` so an unmapped value degrades to readable
 * English instead of to `undefined`.
 * ------------------------------------------------------------------------- */

/**
 * Last-resort prettifier for an internal identifier.
 *
 * `order_placement` → "Order placement", `auth.login_failed` → "Auth login
 * failed", `wc-processing` → "Wc processing". Not clever, and not a substitute
 * for a real label — but it is never worse than the raw token, and it means a
 * new enum value from an upstream API cannot render as machine text.
 */
export function humanizeToken(value: string): string {
  const words = value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return value;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** `humanizeToken` with a lookup table in front of it. */
export function labelFor(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback = 'Unknown',
): string {
  if (!value) return fallback;
  return map[value] ?? humanizeToken(value);
}

/** Order lifecycle, as the shop owner would say it out loud. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Not started',
  confirmed: 'Confirmed',
  paid: 'Paid',
  processing: 'Being prepared',
  fulfilled: 'Sent to the customer',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  // WooCommerce prefixes its own statuses; owners see the same words either way.
  'wc-pending': 'Not started',
  'wc-processing': 'Being prepared',
  'wc-completed': 'Completed',
  'wc-cancelled': 'Cancelled',
  'wc-refunded': 'Refunded',
};

export const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  pickup: 'Collection',
  dine_in: 'Eat in',
  service: 'Service',
  digital: 'Digital',
};

/** Product/menu-item state, which arrives from the connected shop. */
export const CATALOG_STATUS_LABELS: Record<string, string> = {
  active: 'On sale',
  draft: 'Not published',
  archived: 'Archived',
  out_of_stock: 'Out of stock',
};

/** The apps a company can connect. Proper product names, properly capitalised. */
export const PROVIDER_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  wordpress: 'WordPress',
  square: 'Square',
  foodics: 'Foodics',
  google_calendar: 'Google Calendar',
  custom_api: 'Your own system',
  csv: 'Spreadsheet upload',
  webhook: 'Webhook',
  slack: 'Slack',
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  whatsapp_cloud: 'WhatsApp',
  meta: 'Facebook & Instagram',
  telegram: 'Telegram',
  twilio: 'Twilio',
};

/** Connection health, for an integration or a connector. */
export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  active: 'Working',
  connected: 'Working',
  pending: 'Waiting to start',
  paused: 'Paused',
  disconnected: 'Disconnected',
  error: 'Needs attention',
  revoked: 'Disconnected',
};

/** Did this message / sync / automation actually go out? */
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  queued: 'Waiting to send',
  running: 'In progress',
  success: 'Done',
  completed: 'Done',
  skipped: 'Not needed',
  failed: 'Did not send',
  error: 'Did not send',
};

/**
 * Meta's WhatsApp health values.
 *
 * `GREEN`/`RED` and `TIER_1K` are Meta's words shouted in capitals. The rating
 * decides whether Meta will keep delivering your messages, so this is the one
 * screen where a mistranslation matters — the wording says what happens next,
 * not just what the colour is.
 */
export const WHATSAPP_QUALITY_LABELS: Record<string, string> = {
  GREEN: 'Good',
  YELLOW: 'At risk',
  RED: 'Restricted by WhatsApp',
  UNKNOWN: 'Not reported yet',
  NA: 'Not reported yet',
};

export const WHATSAPP_NAME_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  AVAILABLE_WITHOUT_REVIEW: 'Approved',
  PENDING_REVIEW: 'Being reviewed by WhatsApp',
  DECLINED: 'Rejected — pick another name',
  NONE: 'Not submitted',
  EXPIRED: 'Expired',
};

/** How many different people you may message first in 24 hours. */
export const WHATSAPP_TIER_LABELS: Record<string, string> = {
  TIER_50: '50 new customers a day',
  TIER_250: '250 new customers a day',
  TIER_1K: '1,000 new customers a day',
  TIER_10K: '10,000 new customers a day',
  TIER_100K: '100,000 new customers a day',
  TIER_UNLIMITED: 'No daily limit',
};

/**
 * Whether a member is at their desk right now.
 *
 * Roles deliberately do NOT live here — `companyLabel('role', …)` in
 * `src/lib/labels.ts` already owns them ("Owner" / "Team member"), and a second
 * copy is exactly the drift this file exists to stop.
 */
export const PRESENCE_LABELS: Record<string, string> = {
  online: 'Available',
  away: 'Away from my desk',
  offline: 'Not working',
  busy: 'Busy',
};

/** Where an invitation to join the workspace has got to. */
export const INVITE_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for them to accept',
  accepted: 'Joined',
  revoked: 'Cancelled',
  expired: 'Expired',
};

/**
 * Is this rule/campaign/automation doing anything right now?
 *
 * Shared by chat invites, automatic messages and guided chats, which all stored
 * `active`/`paused` and all printed it raw. "Active" is ambiguous in a badge —
 * active as in busy, or active as in enabled? — so the label says which.
 */
export const ACTIVATION_STATUS_LABELS: Record<string, string> = {
  active: 'Switched on',
  enabled: 'Switched on',
  live: 'Live for customers',
  paused: 'Paused',
  draft: 'Not switched on yet',
  disabled: 'Switched off',
  archived: 'Archived',
};

/**
 * Where a booking request has got to.
 *
 * The Bookings page ran `status.replace(/_/g, ' ')` into both the badge and the
 * dropdown, so an owner picked "no show" from a list of lowercase fragments.
 */
export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  requested: 'Asked for — not confirmed',
  confirmed: 'Confirmed',
  completed: 'Happened',
  cancelled: 'Cancelled',
  no_show: 'They did not turn up',
  rescheduled: 'Moved to another time',
};

/**
 * WhatsApp's verdict on one of your saved message templates.
 *
 * Separate from `WHATSAPP_NAME_STATUS_LABELS`, which is Meta's verdict on your
 * business *name*. Both arrive in capitals and both were printed verbatim.
 */
export const WHATSAPP_TEMPLATE_STATUS_LABELS: Record<string, string> = {
  approved: 'Approved — you can send it',
  APPROVED: 'Approved — you can send it',
  pending: 'Being reviewed by WhatsApp',
  PENDING: 'Being reviewed by WhatsApp',
  rejected: 'Rejected — edit and resubmit',
  REJECTED: 'Rejected — edit and resubmit',
  paused: 'Paused by WhatsApp',
  PAUSED: 'Paused by WhatsApp',
  disabled: 'Blocked by WhatsApp',
  DISABLED: 'Blocked by WhatsApp',
  in_appeal: 'You have appealed — waiting',
  IN_APPEAL: 'You have appealed — waiting',
};

/** The plan a company is on, as it is sold rather than as it is stored. */
export const PLAN_LABELS: Record<string, string> = {
  free_trial: 'Free trial',
  trial: 'Free trial',
  none: 'No plan',
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  custom: 'Custom',
};

/** Whether that plan is currently being paid for. */
export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trialing: 'On a free trial',
  active: 'Paid and active',
  past_due: 'Payment failed',
  canceled: 'Cancelled',
  cancelled: 'Cancelled',
  paused: 'Paused',
  incomplete: 'Not finished signing up',
};

/** What a customer asked you to do with their data. */
export const PRIVACY_REQUEST_LABELS: Record<string, string> = {
  export: 'Send me my data',
  delete: 'Delete my data',
  access: 'Send me my data',
  rectify: 'Correct my data',
};

/**
 * The buttons a visitor can be shown under the chat, by what tapping one does.
 *
 * One map, used by both the Chat buttons page and the form that creates them —
 * they each had their own, and the same stored value read "Message" on the list
 * and "Send message" on the form.
 */
export const QUICK_ACTION_TYPE_LABELS: Record<string, string> = {
  send_message: 'Sends a message to the assistant',
  direct_answer: 'Shows an answer straight away',
  lead_form: 'Asks for their details',
  appointment_form: 'Starts a booking',
  external_link: 'Opens a web page',
  product_link: 'Opens one of your products',
  whatsapp: 'Opens WhatsApp',
  phone_call: 'Starts a phone call',
  request_human: 'Asks for a person',
  tool_action: 'Runs something in your shop system',
};

/** Who sees a chat button. */
export const QUICK_ACTION_AUDIENCE_LABELS: Record<string, string> = {
  customer: 'Customers on your website',
  internal: 'Your own staff',
  both: 'Both customers and staff',
};

/** Where a chat button came from. */
export const QUICK_ACTION_SOURCE_LABELS: Record<string, string> = {
  manual: 'You added it',
  default: 'Added for you at setup',
  connector: 'Came from your connected shop',
  ai_contextual: 'Suggested by the assistant',
};

/**
 * What KIND of moment a button belongs to. Stored as `context_mode`.
 *
 * Distinct from `QUICK_ACTION_MOMENT_LABELS` below, which is the list of actual
 * moments a button may be pinned to (`contexts`). The two were conflated once
 * and every page after the first one showed the wrong words.
 */
export const QUICK_ACTION_CONTEXT_LABELS: Record<string, string> = {
  initial: 'When the chat first opens',
  contextual: 'When it fits what they just said',
  follow_up: 'After the assistant answers',
  navigation: 'When they are looking for a page',
  action: 'When they are ready to do something',
};

/** The specific moments a chat button can be pinned to. Stored as `contexts`. */
export const QUICK_ACTION_MOMENT_LABELS: Record<string, string> = {
  initial: 'When the chat first opens',
  after_answer: 'Just after the assistant answers',
  product_page: 'On a product page',
  pricing_page: 'On your prices page',
  support_page: 'On your help page',
};

/** Where a bulk message has got to. */
export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  draft: 'Not sent yet',
  scheduled: 'Waiting to send',
  sending: 'Sending now',
  sent: 'Sent',
  cancelled: 'Cancelled',
  failed: 'Did not send',
};

/** How urgently a conversation has to be answered. */
export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/**
 * Enquiry stages, as the shop owner would say them.
 *
 * Lives here rather than beside the status control: that control is a
 * `'use client'` module, and a server component importing a plain object from
 * one fails at runtime with "Could not find the module ... in the React Client
 * Manifest" — a page that renders blank with nothing wrong at compile time.
 */
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New enquiry',
  contacted: 'I have contacted them',
  qualified: 'Worth pursuing',
  converted: 'Became a customer',
  closed: 'Closed',
};
