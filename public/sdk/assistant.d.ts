/**
 * Type declarations for the AIAssistant JavaScript SDK (`assistant.js`).
 *
 * The SDK is a dependency-free UMD build with no compile step, so these
 * declarations are hand-written and must be kept in step with `assistant.js`.
 */

export interface AIAssistantOptions {
  /** `ak_live_…` — server side only. Never ship a key to a browser. */
  apiKey: string;
  /** Origin of your AIAssistant installation, e.g. `https://app.example.com`. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Retries for 429/5xx/network failures. Default 2. */
  maxRetries?: number;
  /** Injected fetch (Node < 18, or a test double). */
  fetch?: typeof fetch;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Single<T> {
  data: T;
}

export interface ListParams {
  page?: number;
  per_page?: number;
}

export interface Conversation {
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

export interface Message {
  id: string;
  conversation_id: string;
  channel: string;
  sender_type: 'visitor' | 'ai' | 'agent' | 'system';
  sender_id: string | null;
  content_text: string;
  content_type: string;
  language: string | null;
  created_at: string | null;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface SentMessage extends Message {
  delivery: {
    delivered: boolean;
    transport: 'in_app' | 'channel';
    reason: string | null;
  };
}

export interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  enquiry_type: string | null;
  message: string | null;
  source: string | null;
  source_page: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed';
  conversation_id: string | null;
  created_at: string | null;
}

export interface Order {
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

export interface Product {
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

export interface Broadcast {
  id: string;
  channel: 'whatsapp' | 'email';
  subject: string | null;
  message: string;
  audience: string;
  schedule_at: string | null;
  status: string;
  sent_count: number;
  created_at: string | null;
}

export interface AnalyticsSummary {
  range: { from: string; to: string };
  conversations: { started: number; closed: number };
  messages: { total: number; visitor: number; ai: number; agent: number };
  leads: number;
  appointments: number;
  orders: number;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'not_configured'
  | 'internal_error'
  | 'network_error'
  | 'invalid_response'
  | 'request_failed';

export declare class AIAssistantError extends Error {
  name: 'AIAssistantError';
  code: ApiErrorCode | string;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  body?: unknown;
}

export declare class AIAssistant {
  constructor(options: AIAssistantOptions);

  static readonly VERSION: string;
  static readonly AIAssistantError: typeof AIAssistantError;

  readonly baseUrl: string;

  readonly conversations: {
    list(params?: ListParams & {
      status?: string;
      channel?: string;
      since?: string;
    }): Promise<Paginated<Conversation>>;
    get(id: string): Promise<Single<ConversationWithMessages>>;
  };

  readonly messages: {
    send(body: {
      text: string;
      conversation_id?: string;
      channel?: string;
      to?: string;
    }): Promise<Single<SentMessage>>;
  };

  readonly contacts: {
    list(params?: ListParams & {
      status?: string;
      source?: string;
      since?: string;
      q?: string;
    }): Promise<Paginated<Contact>>;
    create(body: {
      name?: string;
      email?: string;
      phone?: string;
      enquiry_type?: string;
      message?: string;
      source_page?: string;
      status?: Contact['status'];
    }): Promise<Single<Contact>>;
    get(id: string): Promise<Single<Contact>>;
  };

  readonly orders: {
    list(params?: ListParams & {
      source?: 'chat' | 'synced';
      status?: string;
      since?: string;
    }): Promise<Paginated<Order>>;
  };

  readonly products: {
    list(params?: ListParams & {
      category?: string;
      status?: string;
      q?: string;
    }): Promise<Paginated<Product>>;
  };

  readonly broadcasts: {
    create(body: {
      channel: 'whatsapp' | 'email';
      message: string;
      subject?: string;
      schedule_at?: string;
    }): Promise<Single<Broadcast>>;
  };

  readonly analytics: {
    summary(params?: { from?: string; to?: string }): Promise<Single<AnalyticsSummary>>;
  };

  /** Escape hatch for an endpoint the typed helpers do not cover yet. */
  request<T = unknown>(
    method: string,
    path: string,
    options?: { query?: Record<string, unknown>; body?: unknown },
  ): Promise<T>;
}

export default AIAssistant;
