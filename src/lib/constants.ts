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
  'phone',
  'api',
] as const;
export type Channel = (typeof CHANNELS)[number];

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
