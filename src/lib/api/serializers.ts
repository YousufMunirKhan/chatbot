/**
 * Row → public JSON shaping for `/api/v1`.
 *
 * Kept apart from the route files so the public contract is visible in one
 * place: every field a customer's integration can depend on is listed here, and
 * an internal column can be added to a table without leaking into the API.
 * Names are snake_case to match the rest of the envelope.
 */

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => Number(v ?? 0);

export interface ApiConversation {
  id: string;
  channel: string;
  status: string;
  language: string | null;
  visitor_id: string | null;
  customer_id: string | null;
  assigned_agent_id: string | null;
  ai_enabled: boolean;
  unread_count: number;
  started_at: string | null;
  last_message_at: string | null;
  closed_at: string | null;
}

export const CONVERSATION_COLUMNS =
  'id,channel,status,language,visitor_id,customer_id,assigned_agent_id,ai_enabled,unread_count,started_at,last_message_at,closed_at';

export function toApiConversation(row: Row): ApiConversation {
  return {
    id: row.id as string,
    channel: (row.channel as string) ?? 'web_chat',
    status: (row.status as string) ?? 'ai_active',
    language: str(row.language),
    visitor_id: str(row.visitor_id),
    customer_id: str(row.customer_id),
    assigned_agent_id: str(row.assigned_agent_id),
    ai_enabled: row.ai_enabled !== false,
    unread_count: num(row.unread_count),
    started_at: str(row.started_at),
    last_message_at: str(row.last_message_at),
    closed_at: str(row.closed_at),
  };
}

export interface ApiMessage {
  id: string;
  conversation_id: string;
  channel: string;
  sender_type: string;
  sender_id: string | null;
  content_text: string;
  content_type: string;
  language: string | null;
  created_at: string | null;
}

export const MESSAGE_COLUMNS =
  'id,conversation_id,channel,sender_type,sender_id,content_text,content_type,language,created_at';

export function toApiMessage(row: Row): ApiMessage {
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    channel: (row.channel as string) ?? 'web_chat',
    sender_type: (row.sender_type as string) ?? 'system',
    sender_id: str(row.sender_id),
    content_text: (row.content_text as string) ?? '',
    content_type: (row.content_type as string) ?? 'text',
    language: str(row.language),
    created_at: str(row.created_at),
  };
}

export interface ApiContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  enquiry_type: string | null;
  message: string | null;
  source: string | null;
  source_page: string | null;
  status: string;
  conversation_id: string | null;
  created_at: string | null;
}

export const CONTACT_COLUMNS =
  'id,name,email,phone,enquiry_type,message,source,source_page,status,conversation_id,created_at';

export function toApiContact(row: Row): ApiContact {
  return {
    id: row.id as string,
    name: str(row.name),
    email: str(row.email),
    phone: str(row.phone),
    enquiry_type: str(row.enquiry_type),
    message: str(row.message),
    source: str(row.source),
    source_page: str(row.source_page),
    status: (row.status as string) ?? 'new',
    conversation_id: str(row.conversation_id),
    created_at: str(row.created_at),
  };
}

export interface ApiOrder {
  id: string;
  source: 'chat' | 'synced';
  order_number: string | null;
  status: string | null;
  order_type: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  total: number;
  currency: string;
  created_at: string | null;
}

export const CHAT_ORDER_COLUMNS =
  'id,order_type,status,customer_name,customer_email,customer_phone,total,currency,external_ref,created_at';
export const SYNCED_ORDER_COLUMNS =
  'id,order_number,status,fulfillment_status,customer_name,customer_email,customer_phone,total,currency,placed_at,created_at';

export function toApiChatOrder(row: Row): ApiOrder {
  return {
    id: row.id as string,
    source: 'chat',
    order_number: str(row.external_ref),
    status: str(row.status),
    order_type: str(row.order_type),
    customer_name: str(row.customer_name),
    customer_email: str(row.customer_email),
    customer_phone: str(row.customer_phone),
    total: num(row.total),
    currency: (row.currency as string) ?? 'USD',
    created_at: str(row.created_at),
  };
}

export function toApiSyncedOrder(row: Row): ApiOrder {
  return {
    id: row.id as string,
    source: 'synced',
    order_number: str(row.order_number),
    status: str(row.status) ?? str(row.fulfillment_status),
    order_type: 'synced',
    customer_name: str(row.customer_name),
    customer_email: str(row.customer_email),
    customer_phone: str(row.customer_phone),
    total: num(row.total),
    currency: (row.currency as string) ?? 'USD',
    created_at: str(row.placed_at) ?? str(row.created_at),
  };
}

export interface ApiProduct {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  price: number | null;
  currency: string;
  status: string;
  created_at: string | null;
}

export const PRODUCT_COLUMNS =
  'id,external_id,title,description,category,sku,price,currency,status,created_at';

export function toApiProduct(row: Row): ApiProduct {
  return {
    id: row.id as string,
    external_id: str(row.external_id),
    title: (row.title as string) ?? '',
    description: str(row.description),
    category: str(row.category),
    sku: str(row.sku),
    price: row.price == null ? null : num(row.price),
    currency: (row.currency as string) ?? 'USD',
    status: (row.status as string) ?? 'active',
    created_at: str(row.created_at),
  };
}
