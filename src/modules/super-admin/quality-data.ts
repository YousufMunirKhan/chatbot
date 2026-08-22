import { createSupabaseServiceClient } from '@/lib/db/server';

/** Row cap on the answer-quality scan. Surfaced to the UI, never applied silently. */
export const QUALITY_SAMPLE_CAP = 2000;
/** Companies listed in the "worst performing" table. */
export const QUALITY_COMPANY_CAP = 20;

export interface PlatformQualitySummary {
  /** Exact count of answers in the 30-day window (not the sampled subset). */
  total: number;
  /** Exact count of failed answers in the 30-day window. */
  failed: number;
  /** AI cost summed over `sampled` rows only — USD. */
  cost: number;
  /** How many rows the breakdowns below were actually computed over. */
  sampled: number;
  /** True when `sampled < total`, i.e. the cost and breakdowns are a sample. */
  truncated: boolean;
  sampleCap: number;
  windowDays: number;
  companies: Array<{
    companyId: string;
    companyName: string;
    total: number;
    failed: number;
    cost: number;
  }>;
  companyCap: number;
  companiesTruncated: boolean;
  failures: Array<{ reason: string; count: number }>;
}

/**
 * 30-day platform answer-quality rollup.
 *
 * The headline counts used to be computed over whatever the newest 2000 rows
 * happened to be, while the copy claimed a 30-day window — so on a busy platform
 * "Answers logged" silently became "answers logged in the last few days". The
 * two counts that can be answered exactly are now answered exactly, with a cheap
 * `head` count; the cost and per-company breakdowns still need row data, so they
 * stay sampled and the sample is reported back to the caller to be labelled.
 */
export async function getPlatformQualitySummary(): Promise<PlatformQualitySummary> {
  const sb = createSupabaseServiceClient();
  const windowDays = 30;
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceIso = since.toISOString();

  const [{ count: exactTotal }, { count: exactFailed }, { data, error }] = await Promise.all([
    sb
      .from('answer_quality_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso),
    sb
      .from('answer_quality_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso)
      .not('failure_reason', 'is', null),
    sb
      .from('answer_quality_logs')
      .select('company_id,failure_reason,estimated_cost, companies(name)')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(QUALITY_SAMPLE_CAP),
  ]);
  if (error) throw error;

  const companyMap = new Map<string, { companyId: string; companyName: string; total: number; failed: number; cost: number }>();
  const failureMap = new Map<string, number>();
  let sampled = 0;
  let cost = 0;

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    sampled++;
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
      entry.failed++;
      const reason = row.failure_reason as string;
      failureMap.set(reason, (failureMap.get(reason) ?? 0) + 1);
    }
    companyMap.set(companyId, entry);
  }

  const total = exactTotal ?? sampled;
  const rankedCompanies = Array.from(companyMap.values()).sort(
    (a, b) => b.failed - a.failed || b.cost - a.cost,
  );

  return {
    total,
    failed: exactFailed ?? 0,
    cost,
    sampled,
    truncated: sampled < total,
    sampleCap: QUALITY_SAMPLE_CAP,
    windowDays,
    companies: rankedCompanies.slice(0, QUALITY_COMPANY_CAP),
    companyCap: QUALITY_COMPANY_CAP,
    companiesTruncated: rankedCompanies.length > QUALITY_COMPANY_CAP,
    failures: Array.from(failureMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface AutoAuditIssueRow {
  id: string;
  companyId: string;
  companyName: string;
  conversationId: string | null;
  question: string;
  answer: string;
  status: string;
  label: string | null;
  score: number | null;
  reason: string | null;
  suggestedFix: string | null;
  createdAt: string;
}

export async function listAutoAuditIssues(limit = 30): Promise<AutoAuditIssueRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('answer_quality_logs')
    .select(
      'id,company_id,conversation_id,question,answer,auto_audit_status,auto_audit_label,auto_audit_score,auto_audit_reason,suggested_fix,created_at, companies(name)',
    )
    .in('auto_audit_status', ['needs_review', 'failed'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const x = row as Record<string, unknown>;
    const company = x.companies as { name?: string } | { name?: string }[] | null;
    const companyName = Array.isArray(company) ? company[0]?.name : company?.name;
    return {
      id: x.id as string,
      companyId: x.company_id as string,
      companyName: companyName ?? 'Unknown company',
      conversationId: (x.conversation_id as string) ?? null,
      question: String(x.question ?? ''),
      answer: String(x.answer ?? ''),
      status: (x.auto_audit_status as string) ?? 'needs_review',
      label: (x.auto_audit_label as string) ?? null,
      score: x.auto_audit_score == null ? null : Number(x.auto_audit_score),
      reason: (x.auto_audit_reason as string) ?? null,
      suggestedFix: (x.suggested_fix as string) ?? null,
      createdAt: x.created_at as string,
    };
  });
}

export interface PlatformEvalRow {
  companyId: string;
  companyName: string;
  total: number;
  passed: number;
  avgAnswerScore: number | null;
  createdAt: string | null;
}

/** Graded runs scanned when working out each company's latest score. */
export const EVAL_RUN_SCAN_CAP = 5000;
/** Companies listed in the platform evaluation table. */
export const EVAL_COMPANY_CAP = 20;

export interface PlatformEvalSummary {
  rows: PlatformEvalRow[];
  /** Companies that have at least one graded run inside the scanned window. */
  companiesFound: number;
  companyCap: number;
  /** True when more companies have graded runs than the table shows. */
  companiesTruncated: boolean;
  /** True when the run scan hit its cap, so an inactive company may be missing. */
  scanTruncated: boolean;
  scanCap: number;
}

/**
 * Latest graded evaluation run per company, for the super-admin platform view.
 * Tolerates the pre-migration schema (returns an empty summary if the graded
 * columns don't exist yet).
 *
 * The scan cap was 500 runs. Because the de-duplication keeps the newest run per
 * company, a handful of companies re-running evaluations was enough to push
 * everyone else's most recent run past the cap and make those companies vanish
 * from the table with no indication. The cap is higher now and, more importantly,
 * reported: when it bites, the page says so.
 */
export async function getPlatformEvalSummary(): Promise<PlatformEvalSummary> {
  const empty: PlatformEvalSummary = {
    rows: [],
    companiesFound: 0,
    companyCap: EVAL_COMPANY_CAP,
    companiesTruncated: false,
    scanTruncated: false,
    scanCap: EVAL_RUN_SCAN_CAP,
  };
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('eval_runs')
    .select('company_id,total,passed,avg_answer_score,graded,created_at, companies(name)')
    .eq('graded', true)
    .order('created_at', { ascending: false })
    .limit(EVAL_RUN_SCAN_CAP);
  if (error || !data) return empty;

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
  const ranked = rows.sort((a, b) => (a.avgAnswerScore ?? 0) - (b.avgAnswerScore ?? 0));
  return {
    rows: ranked.slice(0, EVAL_COMPANY_CAP),
    companiesFound: ranked.length,
    companyCap: EVAL_COMPANY_CAP,
    companiesTruncated: ranked.length > EVAL_COMPANY_CAP,
    scanTruncated: data.length >= EVAL_RUN_SCAN_CAP,
    scanCap: EVAL_RUN_SCAN_CAP,
  };
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
