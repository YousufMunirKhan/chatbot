import { createSupabaseServiceClient } from '@/lib/db/server';

export type QuickActionType =
  | 'send_message'
  | 'direct_answer'
  | 'lead_form'
  | 'appointment_form'
  | 'external_link'
  | 'product_link'
  | 'whatsapp'
  | 'phone_call'
  | 'request_human'
  | 'tool_action';

export interface QuickActionField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'time' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface QuickActionPublic {
  id: string;
  label: string;
  description: string | null;
  actionType: QuickActionType;
  config: Record<string, unknown>;
  formSchema: QuickActionField[];
  startsNewMessage: boolean;
}

export function normalizeList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  if (!value) return [];
  return value
    .split(/[\n\r,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Action config must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function parseFieldLine(line: string): QuickActionField | null {
  const parts = line.split('|').map((p) => p.trim());
  if (!parts[0]) return null;
  const [name, label, type = 'text', required, options] = parts;
  return {
    name,
    label: label || name,
    type: ['text', 'email', 'tel', 'date', 'time', 'textarea', 'select'].includes(type)
      ? (type as QuickActionField['type'])
      : 'text',
    required: required === 'required' || required === 'true' || required === '*',
    options: options ? normalizeList(options) : undefined,
  };
}

export function parseFormSchema(value: string | null | undefined): QuickActionField[] {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Form schema must be a JSON array.');
    return parsed as QuickActionField[];
  }
  return trimmed
    .split(/\r?\n/)
    .map(parseFieldLine)
    .filter((field): field is QuickActionField => Boolean(field));
}

export function serializeFormSchema(fields: unknown): string {
  if (!Array.isArray(fields)) return '';
  return fields
    .map((field) => {
      const f = field as QuickActionField;
      return [f.name, f.label, f.type, f.required ? 'required' : '', f.options?.join(', ') ?? ''].join('|').replace(/\|+$/, '');
    })
    .join('\n');
}

export function parseQuickActionConfig(params: {
  actionType: QuickActionType;
  customConfig?: string | null;
  messageText?: string | null;
  directAnswer?: string | null;
  url?: string | null;
  phone?: string | null;
}): Record<string, unknown> {
  const custom = parseJsonObject(params.customConfig);
  if (params.messageText?.trim()) custom.message_text = params.messageText.trim();
  if (params.directAnswer?.trim()) custom.direct_answer = params.directAnswer.trim();
  if (params.url?.trim()) custom.url = params.url.trim();
  if (params.phone?.trim()) custom.phone = params.phone.trim();
  if (params.actionType === 'request_human' && !custom.message_text) {
    custom.message_text = 'I want to talk to a human agent';
  }
  return custom;
}

export function mapQuickAction(row: Record<string, unknown>): QuickActionPublic {
  return {
    id: row.id as string,
    label: row.label as string,
    description: (row.description as string) ?? null,
    actionType: row.action_type as QuickActionType,
    config: (row.action_config_json as Record<string, unknown>) ?? {},
    formSchema: Array.isArray(row.form_schema_json) ? (row.form_schema_json as QuickActionField[]) : [],
    startsNewMessage: Boolean(row.starts_new_message),
  };
}

function patternMatches(pattern: string, pageUrl: string): boolean {
  if (!pattern.trim()) return false;
  if (pattern === '*') return true;
  return pageUrl.toLowerCase().includes(pattern.toLowerCase());
}

export function filterQuickActionRows(
  rows: Array<Record<string, unknown>>,
  params: { context?: string; pageUrl?: string; capabilities?: string[] },
): QuickActionPublic[] {
  const context = params.context || 'initial';
  const pageUrl = params.pageUrl || '';
  const caps = new Set(params.capabilities ?? []);

  return rows
    .filter((row) => {
      const contexts = toStringArray(row.contexts);
      if (contexts.length && !contexts.includes(context)) return false;
      const patterns = toStringArray(row.page_url_patterns);
      if (patterns.length && !patterns.some((p) => patternMatches(p, pageUrl))) return false;
      const required = toStringArray(row.required_capabilities);
      if (required.length && !required.every((cap) => caps.has(cap))) return false;
      return true;
    })
    .map(mapQuickAction);
}

export async function loadPublicQuickActions(params: {
  companyId: string;
  botId: string;
  context?: string;
  pageUrl?: string;
  capabilities?: string[];
  limit?: number;
}): Promise<QuickActionPublic[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('bot_quick_actions')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('is_active', true)
    .or(`bot_id.eq.${params.botId},bot_id.is.null`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return filterQuickActionRows((data ?? []) as Array<Record<string, unknown>>, params).slice(0, params.limit ?? 8);
}
