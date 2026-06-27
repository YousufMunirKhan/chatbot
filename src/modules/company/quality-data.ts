import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export interface QualitySummary {
  total: number;
  failed: number;
  handoffs: number;
  cost: number;
  avgLatencyMs: number;
  topFailures: Array<{ reason: string; count: number }>;
  topQuestions: Array<{ question: string; count: number }>;
  recent: Array<{
    id: string;
    question: string;
    answer: string;
    model: string | null;
    cost: number;
    failureReason: string | null;
    sourceTypes: string[];
    createdAt: string;
  }>;
}

export interface KnowledgeIndexSummary {
  readyDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  lastIndexedAt: string | null;
}

export interface QualityFixRow {
  id: string;
  question: string;
  correctionText: string;
  fixType: string;
  status: string;
  chunksCreated: number;
  editHref: string;
  createdAt: string;
}

function summarize(rows: Array<Record<string, unknown>>): QualitySummary {
  const failureCounts = new Map<string, number>();
  const questionCounts = new Map<string, number>();
  let cost = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  let handoffs = 0;

  for (const row of rows) {
    const failure = row.failure_reason as string | null;
    if (failure) failureCounts.set(failure, (failureCounts.get(failure) ?? 0) + 1);
    const question = String(row.question ?? '').trim();
    if (question) questionCounts.set(question, (questionCounts.get(question) ?? 0) + 1);
    cost += Number(row.estimated_cost ?? 0);
    const latency = Number(row.latency_ms ?? 0);
    if (latency > 0) {
      latencyTotal += latency;
      latencyCount++;
    }
    if (['needs_human', 'human_active', 'suggested'].includes(String(row.handoff_status ?? ''))) handoffs++;
  }

  return {
    total: rows.length,
    failed: rows.filter((r) => Boolean(r.failure_reason)).length,
    handoffs,
    cost,
    avgLatencyMs: latencyCount ? Math.round(latencyTotal / latencyCount) : 0,
    topFailures: Array.from(failureCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    topQuestions: Array.from(questionCounts.entries())
      .map(([question, count]) => ({ question, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    recent: rows.slice(0, 25).map((row) => ({
      id: row.id as string,
      question: String(row.question ?? ''),
      answer: String(row.answer ?? ''),
      model: (row.model as string) ?? null,
      cost: Number(row.estimated_cost ?? 0),
      failureReason: (row.failure_reason as string) ?? null,
      sourceTypes: Array.isArray(row.source_types) ? row.source_types.map(String) : [],
      createdAt: row.created_at as string,
    })),
  };
}

export async function getCompanyQualitySummary(): Promise<QualitySummary> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await sb
    .from('answer_quality_logs')
    .select('*')
    .eq('company_id', companyId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return summarize((data ?? []) as Array<Record<string, unknown>>);
}

export async function getKnowledgeIndexSummary(): Promise<KnowledgeIndexSummary> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const [readyDocs, failedDocs, chunks, latest] = await Promise.all([
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'ready'),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'failed'),
    sb.from('chunks').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    sb
      .from('documents')
      .select('updated_at,created_at')
      .eq('company_id', companyId)
      .eq('status', 'ready')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (readyDocs.error) throw readyDocs.error;
  if (failedDocs.error) throw failedDocs.error;
  if (chunks.error) throw chunks.error;
  if (latest.error) throw latest.error;
  const latestRow = latest.data as { updated_at?: string | null; created_at?: string | null } | null;
  return {
    readyDocuments: readyDocs.count ?? 0,
    failedDocuments: failedDocs.count ?? 0,
    totalChunks: chunks.count ?? 0,
    lastIndexedAt: latestRow?.updated_at ?? latestRow?.created_at ?? null,
  };
}

export async function listQualityFixes(): Promise<QualityFixRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('answer_quality_feedback')
    .select('id,quality_log_id,status,correction_text,metadata_json,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw error;

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const logIds = rows.map((row) => row.quality_log_id as string).filter(Boolean);
  const questions = new Map<string, string>();
  if (logIds.length) {
    const { data: logs, error: logsError } = await sb
      .from('answer_quality_logs')
      .select('id,question')
      .eq('company_id', companyId)
      .in('id', logIds);
    if (logsError) throw logsError;
    for (const log of logs ?? []) {
      questions.set(log.id as string, String(log.question ?? ''));
    }
  }

  return rows.map((row) => {
    const metadata = ((row.metadata_json as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      question: questions.get(row.quality_log_id as string) ?? 'Quality fix',
      correctionText: String(row.correction_text ?? ''),
      fixType: String(metadata.fixType ?? metadata.structuredType ?? 'knowledge'),
      status: String(row.status ?? 'fixed'),
      chunksCreated: Number(metadata.chunksCreated ?? 0),
      editHref: String(metadata.editHref ?? '/company/knowledge'),
      createdAt: row.created_at as string,
    };
  });
}
