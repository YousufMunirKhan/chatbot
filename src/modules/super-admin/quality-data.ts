import { createSupabaseServiceClient } from '@/lib/db/server';

export interface PlatformQualitySummary {
  total: number;
  failed: number;
  cost: number;
  companies: Array<{
    companyId: string;
    companyName: string;
    total: number;
    failed: number;
    cost: number;
  }>;
  failures: Array<{ reason: string; count: number }>;
}

export async function getPlatformQualitySummary(): Promise<PlatformQualitySummary> {
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await sb
    .from('answer_quality_logs')
    .select('company_id,failure_reason,estimated_cost, companies(name)')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const companyMap = new Map<string, { companyId: string; companyName: string; total: number; failed: number; cost: number }>();
  const failureMap = new Map<string, number>();
  let total = 0;
  let failed = 0;
  let cost = 0;

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    total++;
    const rowCost = Number(row.estimated_cost ?? 0);
    cost += rowCost;
    const companyId = row.company_id as string;
    const company = row.companies as { name?: string } | { name?: string }[] | null;
    const companyName = Array.isArray(company) ? company[0]?.name : company?.name;
    const entry =
      companyMap.get(companyId) ??
      { companyId, companyName: companyName ?? 'Unknown company', total: 0, failed: 0, cost: 0 };
    entry.total++;
    entry.cost += rowCost;
    if (row.failure_reason) {
      failed++;
      entry.failed++;
      const reason = row.failure_reason as string;
      failureMap.set(reason, (failureMap.get(reason) ?? 0) + 1);
    }
    companyMap.set(companyId, entry);
  }

  return {
    total,
    failed,
    cost,
    companies: Array.from(companyMap.values())
      .sort((a, b) => b.failed - a.failed || b.cost - a.cost)
      .slice(0, 20),
    failures: Array.from(failureMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface PlatformEvalRow {
  companyId: string;
  companyName: string;
  total: number;
  passed: number;
  avgAnswerScore: number | null;
  createdAt: string | null;
}

/**
 * Latest graded evaluation run per company, for the super-admin platform view.
 * Tolerates the pre-migration schema (returns [] if the graded columns don't
 * exist yet).
 */
export async function getPlatformEvalSummary(): Promise<PlatformEvalRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('eval_runs')
    .select('company_id,total,passed,avg_answer_score,graded,created_at, companies(name)')
    .eq('graded', true)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error || !data) return [];

  // Keep only the most recent graded run per company (data is newest-first).
  const seen = new Set<string>();
  const rows: PlatformEvalRow[] = [];
  for (const r of data as Array<Record<string, unknown>>) {
    const companyId = r.company_id as string;
    if (seen.has(companyId)) continue;
    seen.add(companyId);
    const company = r.companies as { name?: string } | { name?: string }[] | null;
    const companyName = Array.isArray(company) ? company[0]?.name : company?.name;
    rows.push({
      companyId,
      companyName: companyName ?? 'Unknown company',
      total: Number(r.total ?? 0),
      passed: Number(r.passed ?? 0),
      avgAnswerScore: r.avg_answer_score == null ? null : Number(r.avg_answer_score),
      createdAt: (r.created_at as string) ?? null,
    });
  }
  return rows.sort((a, b) => (a.avgAnswerScore ?? 0) - (b.avgAnswerScore ?? 0)).slice(0, 20);
}

export interface CompanyEvalDetail {
  avgAnswerScore: number | null;
  total: number;
  passed: number;
  createdAt: string | null;
  results: Array<{ question: string; score: number | null; verdict: string | null; rationale: string; fix: string }>;
}

/** Latest graded eval run for one company, with per-question scores + rationale. */
export async function getCompanyEvalDetail(companyId: string): Promise<CompanyEvalDetail | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('eval_runs')
    .select('total,passed,avg_answer_score,results_json,created_at')
    .eq('company_id', companyId)
    .eq('graded', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const x = data as Record<string, unknown>;
  const rawResults = Array.isArray(x.results_json) ? (x.results_json as Array<Record<string, unknown>>) : [];
  return {
    avgAnswerScore: x.avg_answer_score == null ? null : Number(x.avg_answer_score),
    total: Number(x.total ?? 0),
    passed: Number(x.passed ?? 0),
    createdAt: (x.created_at as string) ?? null,
    results: rawResults.map((r) => {
      const grade = r.grade as Record<string, unknown> | undefined;
      return {
        question: (r.question as string) ?? '',
        score: r.score == null ? null : Number(r.score),
        verdict: (r.verdict as string) ?? null,
        rationale: (grade?.rationale as string) ?? (r.note as string) ?? '',
        fix: (grade?.fix as string) ?? '',
      };
    }),
  };
}
