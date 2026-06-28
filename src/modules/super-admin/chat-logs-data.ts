import { unstable_noStore as noStore } from 'next/cache';
import { createSupabaseServiceClient } from '@/lib/db/server';

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const rec = (v: unknown): Record<string, unknown> => (one(v) ?? {}) as Record<string, unknown>;

export interface ChatLogFilters {
  companyId?: string;
  status?: string;
  auditStatus?: string;
  q?: string;
  limit?: number;
}

export interface ChatLogRow {
  id: string;
  companyId: string;
  companyName: string;
  botName: string | null;
  status: string;
  channel: string;
  language: string | null;
  visitorId: string | null;
  aiEnabled: boolean;
  lastMessageAt: string | null;
  startedAt: string | null;
  qualityStatus: string | null;
  qualityLabel: string | null;
  qualityScore: number | null;
  failureReason: string | null;
  latestQuestion: string | null;
}

export interface ChatMessageRow {
  id: string;
  senderType: string;
  senderId: string | null;
  content: string;
  language: string | null;
  createdAt: string;
}

export interface QualityLogRow {
  id: string;
  question: string;
  answer: string;
  model: string | null;
  provider: string | null;
  autoAuditStatus: string | null;
  autoAuditScore: number | null;
  autoAuditLabel: string | null;
  autoAuditReason: string | null;
  suggestedFix: string | null;
  failureReason: string | null;
  latencyMs: number | null;
  sourceTypes: string[];
  toolsCalled: string[];
  createdAt: string;
}

export interface ChatLogDetail extends ChatLogRow {
  messages: ChatMessageRow[];
  qualityLogs: QualityLogRow[];
}

function normalizeLimit(value: number | undefined, fallback = 100, max = 300): number {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function qualityFrom(row: Record<string, unknown> | undefined): Pick<
  ChatLogRow,
  'qualityStatus' | 'qualityLabel' | 'qualityScore' | 'failureReason' | 'latestQuestion'
> {
  if (!row) {
    return {
      qualityStatus: null,
      qualityLabel: null,
      qualityScore: null,
      failureReason: null,
      latestQuestion: null,
    };
  }
  return {
    qualityStatus: (row.auto_audit_status as string) ?? null,
    qualityLabel: (row.auto_audit_label as string) ?? null,
    qualityScore: row.auto_audit_score == null ? null : Number(row.auto_audit_score),
    failureReason: (row.failure_reason as string) ?? null,
    latestQuestion: (row.question as string) ?? null,
  };
}

function mapQuality(row: Record<string, unknown>): QualityLogRow {
  return {
    id: row.id as string,
    question: String(row.question ?? ''),
    answer: String(row.answer ?? ''),
    model: (row.model as string) ?? null,
    provider: (row.provider as string) ?? null,
    autoAuditStatus: (row.auto_audit_status as string) ?? null,
    autoAuditScore: row.auto_audit_score == null ? null : Number(row.auto_audit_score),
    autoAuditLabel: (row.auto_audit_label as string) ?? null,
    autoAuditReason: (row.auto_audit_reason as string) ?? null,
    suggestedFix: (row.suggested_fix as string) ?? null,
    failureReason: (row.failure_reason as string) ?? null,
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    sourceTypes: Array.isArray(row.source_types) ? row.source_types.map(String) : [],
    toolsCalled: Array.isArray(row.tools_called) ? row.tools_called.map(String) : [],
    createdAt: row.created_at as string,
  };
}

export async function listChatLogs(filters: ChatLogFilters = {}): Promise<ChatLogRow[]> {
  noStore();
  const sb = createSupabaseServiceClient();
  let query = sb
    .from('conversations')
    .select('id,company_id,bot_id,status,channel,language,visitor_id,ai_enabled,started_at,last_message_at, companies(name), bots(name)')
    .order('last_message_at', { ascending: false })
    .limit(normalizeLimit(filters.limit));

  if (filters.companyId) query = query.eq('company_id', filters.companyId);
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.q) query = query.ilike('visitor_id', `%${filters.q}%`);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const conversationIds = rows.map((row) => row.id as string);

  const latestQuality = new Map<string, Record<string, unknown>>();
  if (conversationIds.length) {
    let qualityQuery = sb
      .from('answer_quality_logs')
      .select('id,conversation_id,question,failure_reason,auto_audit_status,auto_audit_label,auto_audit_score,created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: false });
    if (filters.auditStatus && filters.auditStatus !== 'all') {
      qualityQuery = qualityQuery.eq('auto_audit_status', filters.auditStatus);
    }
    const { data: qualityRows, error: qualityError } = await qualityQuery;
    if (qualityError) throw qualityError;
    for (const row of (qualityRows ?? []) as Array<Record<string, unknown>>) {
      const conversationId = row.conversation_id as string;
      if (!latestQuality.has(conversationId)) latestQuality.set(conversationId, row);
    }
  }

  return rows
    .filter((row) => !filters.auditStatus || filters.auditStatus === 'all' || latestQuality.has(row.id as string))
    .map((row) => {
      const company = rec(row.companies);
      const bot = rec(row.bots);
      return {
        id: row.id as string,
        companyId: row.company_id as string,
        companyName: (company.name as string) ?? 'Unknown company',
        botName: (bot.name as string) ?? null,
        status: row.status as string,
        channel: row.channel as string,
        language: (row.language as string) ?? null,
        visitorId: (row.visitor_id as string) ?? null,
        aiEnabled: Boolean(row.ai_enabled),
        lastMessageAt: (row.last_message_at as string) ?? null,
        startedAt: (row.started_at as string) ?? null,
        ...qualityFrom(latestQuality.get(row.id as string)),
      };
    });
}

export async function getChatLogDetail(
  conversationId: string,
  adminUserId: string,
): Promise<ChatLogDetail | null> {
  noStore();
  const sb = createSupabaseServiceClient();
  const { data: convo, error } = await sb
    .from('conversations')
    .select('id,company_id,bot_id,status,channel,language,visitor_id,ai_enabled,started_at,last_message_at, companies(name), bots(name)')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!convo) return null;

  const row = convo as Record<string, unknown>;
  await sb.from('admin_access_logs').insert({
    super_admin_id: adminUserId,
    company_id: row.company_id as string,
    action: 'chat.viewed',
    target_type: 'conversation',
    target_id: conversationId,
  });

  const [messagesRes, qualityRes] = await Promise.all([
    sb
      .from('messages')
      .select('id,sender_type,sender_id,content_text,language,created_at')
      .eq('conversation_id', conversationId)
      .eq('company_id', row.company_id as string)
      .order('created_at', { ascending: true }),
    sb
      .from('answer_quality_logs')
      .select(
        'id,question,answer,provider,model,auto_audit_status,auto_audit_score,auto_audit_label,auto_audit_reason,suggested_fix,failure_reason,latency_ms,source_types,tools_called,created_at',
      )
      .eq('conversation_id', conversationId)
      .eq('company_id', row.company_id as string)
      .order('created_at', { ascending: false }),
  ]);
  if (messagesRes.error) throw messagesRes.error;
  if (qualityRes.error) throw qualityRes.error;

  const latest = ((qualityRes.data ?? [])[0] as Record<string, unknown> | undefined) ?? undefined;
  const company = rec(row.companies);
  const bot = rec(row.bots);
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    companyName: (company.name as string) ?? 'Unknown company',
    botName: (bot.name as string) ?? null,
    status: row.status as string,
    channel: row.channel as string,
    language: (row.language as string) ?? null,
    visitorId: (row.visitor_id as string) ?? null,
    aiEnabled: Boolean(row.ai_enabled),
    lastMessageAt: (row.last_message_at as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    ...qualityFrom(latest),
    messages: ((messagesRes.data ?? []) as Array<Record<string, unknown>>).map((message) => ({
      id: message.id as string,
      senderType: message.sender_type as string,
      senderId: (message.sender_id as string) ?? null,
      content: String(message.content_text ?? ''),
      language: (message.language as string) ?? null,
      createdAt: message.created_at as string,
    })),
    qualityLogs: ((qualityRes.data ?? []) as Array<Record<string, unknown>>).map(mapQuality),
  };
}
