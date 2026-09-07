import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

export type InsightStatus = 'new' | 'acknowledged' | 'done' | 'dismissed';
export type InsightSeverity = 'critical' | 'warning' | 'info';

export interface InsightRow {
  id: string;
  category: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  recommendation: string | null;
  evidence: Record<string, unknown>;
  actionHref: string | null;
  actionLabel: string | null;
  status: InsightStatus;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export interface InsightRunRow {
  id: string;
  status: string;
  note: string | null;
  periodDays: number;
  createdAt: string;
  finishedAt: string | null;
  usedModel: boolean;
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };

export async function listInsights(status: InsightStatus[] = ['new', 'acknowledged']): Promise<InsightRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('ai_insights')
    .select(
      'id,category,severity,title,detail,recommendation,evidence_json,action_href,action_label,status,period_start,period_end,created_at',
    )
    .eq('company_id', companyId)
    .in('status', status)
    .order('created_at', { ascending: false })
    .limit(100);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .map((row) => ({
      id: row.id as string,
      category: row.category as string,
      severity: (row.severity as InsightSeverity) ?? 'info',
      title: row.title as string,
      detail: row.detail as string,
      recommendation: (row.recommendation as string) ?? null,
      evidence: (row.evidence_json as Record<string, unknown>) ?? {},
      actionHref: (row.action_href as string) ?? null,
      actionLabel: (row.action_label as string) ?? null,
      status: (row.status as InsightStatus) ?? 'new',
      periodStart: row.period_start as string,
      periodEnd: row.period_end as string,
      createdAt: row.created_at as string,
    }))
    // Most serious first — an owner with ten minutes should read the top of the list.
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export async function getLatestInsightRun(): Promise<InsightRunRow | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('ai_insight_runs')
    .select('id,status,note,period_days,created_at,finished_at,model,output_tokens')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    status: row.status as string,
    note: (row.note as string) ?? null,
    periodDays: (row.period_days as number) ?? 30,
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    usedModel: Boolean(row.model),
  };
}

export interface InsightCounts {
  critical: number;
  warning: number;
  info: number;
  done: number;
}

export async function getInsightCounts(): Promise<InsightCounts> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('ai_insights')
    .select('severity,status')
    .eq('company_id', companyId)
    .limit(500);

  const counts: InsightCounts = { critical: 0, warning: 0, info: 0, done: 0 };
  for (const row of (data ?? []) as unknown as Array<{ severity: InsightSeverity; status: InsightStatus }>) {
    if (row.status === 'done') counts.done += 1;
    else if (row.status === 'new' || row.status === 'acknowledged') counts[row.severity] += 1;
  }
  return counts;
}
