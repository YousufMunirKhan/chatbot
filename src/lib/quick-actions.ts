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

export type QuickActionAudience = 'customer' | 'internal' | 'both';
export type QuickActionSource = 'manual' | 'default' | 'connector' | 'ai_contextual';
export type QuickActionContextMode = 'initial' | 'contextual' | 'follow_up' | 'navigation' | 'action';

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
  audience: QuickActionAudience;
  source: QuickActionSource;
  contextMode: QuickActionContextMode;
  config: Record<string, unknown>;
  formSchema: QuickActionField[];
  startsNewMessage: boolean;
  connectorDocumentId: string | null;
  connectorActionId: string | null;
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
    audience: ((row.audience as QuickActionAudience | undefined) ?? 'customer'),
    source: ((row.source as QuickActionSource | undefined) ?? 'manual'),
    contextMode: ((row.context_mode as QuickActionContextMode | undefined) ?? 'initial'),
    config: (row.action_config_json as Record<string, unknown>) ?? {},
    formSchema: Array.isArray(row.form_schema_json) ? (row.form_schema_json as QuickActionField[]) : [],
    startsNewMessage: Boolean(row.starts_new_message),
    connectorDocumentId: (row.connector_document_id as string | null) ?? null,
    connectorActionId: (row.connector_action_id as string | null) ?? null,
  };
}

function patternMatches(pattern: string, pageUrl: string): boolean {
  if (!pattern.trim()) return false;
  if (pattern === '*') return true;
  return pageUrl.toLowerCase().includes(pattern.toLowerCase());
}

function keywordScore(triggers: string[], text: string): number {
  if (!triggers.length) return 0;
  const haystack = text.toLowerCase();
  return triggers.reduce((score, trigger) => {
    const t = trigger.trim().toLowerCase();
    if (!t) return score;
    return haystack.includes(t) ? score + Math.min(20, Math.max(2, t.length)) : score;
  }, 0);
}

function audienceMatches(rowAudience: string | null | undefined, requested: QuickActionAudience): boolean {
  const audience = rowAudience || 'customer';
  if (requested === 'internal') return audience === 'internal' || audience === 'both';
  return audience === 'customer' || audience === 'both';
}

function quickActionSettingsAllow(
  row: Record<string, unknown>,
  settings?: { enableDefaultPills?: boolean; enableContextualPills?: boolean; enableConnectorGeneratedPills?: boolean },
): boolean {
  const source = (row.source as QuickActionSource | undefined) ?? 'manual';
  const contextMode = (row.context_mode as QuickActionContextMode | undefined) ?? 'initial';
  if (settings?.enableDefaultPills === false && source === 'default') return false;
  if (settings?.enableConnectorGeneratedPills === false && source === 'connector') return false;
  if (settings?.enableContextualPills === false && contextMode === 'contextual') return false;
  return true;
}

export function filterQuickActionRows(
  rows: Array<Record<string, unknown>>,
  params: {
    context?: string;
    pageUrl?: string;
    capabilities?: string[];
    audience?: QuickActionAudience;
    settings?: { enableDefaultPills?: boolean; enableContextualPills?: boolean; enableConnectorGeneratedPills?: boolean };
  },
): QuickActionPublic[] {
  const context = params.context || 'initial';
  const pageUrl = params.pageUrl || '';
  const caps = new Set(params.capabilities ?? []);
  const requestedAudience = params.audience ?? 'customer';

  return rows
    .filter((row) => {
      if (!audienceMatches(row.audience as string | undefined, requestedAudience)) return false;
      if (!quickActionSettingsAllow(row, params.settings)) return false;
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
  audience?: QuickActionAudience;
  settings?: { enableDefaultPills?: boolean; enableContextualPills?: boolean; enableConnectorGeneratedPills?: boolean };
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
  return filterQuickActionRows((data ?? []) as Array<Record<string, unknown>>, {
    ...params,
    audience: params.audience ?? 'customer',
  }).slice(0, params.limit ?? 8);
}

export async function loadInternalQuickActions(params: {
  companyId: string;
  botId: string;
  context?: string;
  capabilities?: string[];
  settings?: { enableDefaultPills?: boolean; enableContextualPills?: boolean; enableConnectorGeneratedPills?: boolean };
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
  return filterQuickActionRows((data ?? []) as Array<Record<string, unknown>>, {
    ...params,
    audience: 'internal',
  }).slice(0, params.limit ?? 8);
}

export async function loadContextualQuickActions(params: {
  companyId: string;
  botId: string;
  assistantAudience: QuickActionAudience;
  latestMessage?: string;
  contextText?: string;
  pageUrl?: string;
  capabilities?: string[];
  settings?: { enableDefaultPills?: boolean; enableContextualPills?: boolean; enableConnectorGeneratedPills?: boolean };
  limit?: number;
}): Promise<QuickActionPublic[]> {
  if (params.settings?.enableContextualPills === false) return [];
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('bot_quick_actions')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('is_active', true)
    .or(`bot_id.eq.${params.botId},bot_id.is.null`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(150);
  if (error) throw error;

  const text = [params.latestMessage, params.contextText, params.pageUrl].filter(Boolean).join('\n');
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const candidates = filterQuickActionRows(rows, {
    context: 'contextual',
    pageUrl: params.pageUrl,
    capabilities: params.capabilities,
    audience: params.assistantAudience,
    settings: params.settings,
  });

  return candidates
    .map((action) => {
      const row = rows.find((r) => r.id === action.id);
      const triggers = toStringArray(row?.keyword_triggers);
      const modeBonus = action.contextMode === 'contextual' ? 8 : action.contextMode === 'navigation' || action.contextMode === 'action' ? 5 : 0;
      const score = keywordScore(triggers, text) + modeBonus;
      return { action, score };
    })
    .filter((item) => item.score > 0 || item.action.source === 'connector')
    .sort((a, b) => b.score - a.score)
    .map((item) => item.action)
    .slice(0, params.limit ?? 5);
}
