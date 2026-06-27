import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';

/**
 * Evaluation harness data layer (Module 25). Company-scoped: every query is
 * bound to the session user's own companyId.
 */
export interface EvalQuestionRow {
  id: string;
  botId: string | null;
  question: string;
  expectedSource: string | null;
  expectedAnswerType: string | null;
  language: string;
  mustNotAnswerIfMissing: boolean;
  createdAt: string | null;
}

export interface EvalRunRow {
  total: number;
  passed: number;
  resultsJson: unknown;
  createdAt: string | null;
  graded: boolean;
  avgAnswerScore: number | null;
}

export async function listEvalQuestions(): Promise<EvalQuestionRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('eval_questions')
    .select(
      'id, bot_id, question, expected_source, expected_answer_type, language, must_not_answer_if_missing, created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      botId: (x.bot_id as string) ?? null,
      question: x.question as string,
      expectedSource: (x.expected_source as string) ?? null,
      expectedAnswerType: (x.expected_answer_type as string) ?? null,
      language: (x.language as string) ?? 'en',
      mustNotAnswerIfMissing: Boolean(x.must_not_answer_if_missing),
      createdAt: (x.created_at as string) ?? null,
    };
  });
}

export async function lastRun(): Promise<EvalRunRow | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  // select('*') so this works before AND after the graded-eval migration.
  const { data, error } = await sb
    .from('eval_runs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const x = data as Record<string, unknown>;
  return {
    total: (x.total as number) ?? 0,
    passed: (x.passed as number) ?? 0,
    resultsJson: x.results_json,
    createdAt: (x.created_at as string) ?? null,
    graded: Boolean(x.graded),
    avgAnswerScore: x.avg_answer_score == null ? null : Number(x.avg_answer_score),
  };
}
