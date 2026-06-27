import { createSupabaseServiceClient } from '@/lib/db/server';
import { retrieveContext } from './rag';
import { getChatProviderAsync } from './providers';
import { buildMessages } from './engine';
import { loadCompactBusinessContext } from './business-context';
import { gradeAnswer, type AnswerGrade } from './judge';
import type { AIProvider } from './types';

/**
 * Evaluation harness (Module 25). Two modes:
 *   - Retrieval check (always, even with no AI key): does retrieval find
 *     supporting context, and does the "must not answer if missing" rule hold?
 *   - LLM-graded (with a real key): generate the actual answer and have a judge
 *     model score it on groundedness / correctness / completeness / language,
 *     so ANSWER quality — not just retrieval — is measured and tracked.
 */
export interface EvalResult {
  question: string;
  language: string;
  retrieved: number;
  contextFound: boolean;
  pass: boolean;
  note: string;
  // Populated only on graded runs:
  answer?: string;
  score?: number;
  verdict?: 'pass' | 'fail';
  grade?: AnswerGrade;
}

interface BotInfo {
  id: string;
  systemPrompt: string | null;
  language: string;
}

async function generateAnswer(params: {
  provider: AIProvider;
  model: string;
  systemPrompt: string | null;
  businessContext: string;
  contextText: string;
  question: string;
  language: 'ar' | 'en';
}): Promise<string> {
  const messages = buildMessages({
    systemPrompt: params.systemPrompt,
    businessContext: params.businessContext,
    contextText: params.contextText,
    summary: null,
    history: [],
    language: params.language,
  });
  messages.push({ role: 'user', content: params.question });
  const res = await params.provider.complete({
    model: params.model,
    temperature: 0.2,
    maxTokens: 600,
    messages,
  });
  return res.text;
}

export async function runEval(
  companyId: string,
  botId: string | null,
  opts: { graded?: boolean } = {},
): Promise<{ total: number; passed: number; results: EvalResult[]; graded: boolean; avgScore: number | null }> {
  const sb = createSupabaseServiceClient();
  let q = sb
    .from('eval_questions')
    .select('question, expected_source, expected_answer_type, language, must_not_answer_if_missing, bot_id')
    .eq('company_id', companyId);
  if (botId) q = q.eq('bot_id', botId);
  const { data: questions } = await q;

  // Resolve grading dependencies once.
  let graded = false;
  let provider: AIProvider | null = null;
  let model = '';
  let businessContext = '';
  const botById = new Map<string, BotInfo>();
  let fallbackBot: BotInfo | null = null;
  if (opts.graded) {
    const resolved = await getChatProviderAsync();
    if (resolved.provider.name !== 'mock') {
      graded = true;
      provider = resolved.provider;
      model = resolved.model;
      businessContext = await loadCompactBusinessContext(companyId);
      const { data: bots } = await sb
        .from('bots')
        .select('id, system_prompt, language_default')
        .eq('company_id', companyId);
      for (const b of bots ?? []) {
        const info: BotInfo = {
          id: (b as Record<string, unknown>).id as string,
          systemPrompt: ((b as Record<string, unknown>).system_prompt as string) ?? null,
          language: ((b as Record<string, unknown>).language_default as string) ?? 'en',
        };
        botById.set(info.id, info);
        if (!fallbackBot) fallbackBot = info;
      }
    }
  }

  // Process all questions in parallel (each is independent) — much faster than
  // the previous sequential loop for a graded run.
  const results: EvalResult[] = await Promise.all(
    (questions ?? []).map(async (row): Promise<EvalResult> => {
      const item = row as Record<string, unknown>;
      const question = item.question as string;
      const language = ((item.language as string) ?? 'en') as 'ar' | 'en';
      const mustNotAnswer = Boolean(item.must_not_answer_if_missing);
      const qBotId = (item.bot_id as string) ?? botId ?? null;

      const { chunks, contextText } = await retrieveContext(companyId, qBotId, question, 4);
      const contextFound = chunks.length > 0;
      const retrievalPass = mustNotAnswer ? !contextFound : contextFound;

      const result: EvalResult = {
        question,
        language,
        retrieved: chunks.length,
        contextFound,
        pass: retrievalPass,
        note: contextFound ? `${chunks.length} chunk(s)` : 'no context - assistant should say "I don\'t know"',
      };

      if (graded && provider) {
        const bot = (qBotId && botById.get(qBotId)) || fallbackBot;
        try {
          const answer = await generateAnswer({
            provider,
            model,
            systemPrompt: bot?.systemPrompt ?? null,
            businessContext,
            contextText,
            question,
            language,
          });
          // Judge against the SAME grounding the bot had — business facts +
          // retrieved knowledge — so legitimate profile answers (phone, address)
          // aren't falsely flagged as hallucinations.
          const fullContext = [businessContext, contextText].filter(Boolean).join('\n\n');
          const grade = await gradeAnswer({ question, answer, context: fullContext, language, provider, model });
          result.answer = answer;
          result.grade = grade;
          result.score = grade.score;
          result.verdict = grade.verdict;
          // On graded runs the verdict reflects answer quality, not just retrieval.
          result.pass = grade.verdict === 'pass';
          result.note = grade.rationale || result.note;
        } catch {
          result.note = 'grading failed';
        }
      }

      return result;
    }),
  );

  const scores = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
  const passed = results.filter((r) => r.pass).length;
  const avgScore = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : null;

  // Persist; tolerate pre-migration schema (no graded / avg_answer_score columns).
  const payload: Record<string, unknown> = {
    company_id: companyId,
    bot_id: botId,
    total: results.length,
    passed,
    results_json: results,
  };
  const { error } = await sb.from('eval_runs').insert({ ...payload, graded, avg_answer_score: avgScore });
  if (error) await sb.from('eval_runs').insert(payload);

  return { total: results.length, passed, results, graded, avgScore };
}
