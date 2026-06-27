import type { AIProvider } from '@/lib/ai/types';
import { wrapUntrusted } from '@/lib/ai/safety';

/**
 * LLM-as-judge answer grading (eval harness upgrade).
 *
 * Given a question, the context the bot was allowed to use, and the bot's
 * answer, a judge model scores the answer on groundedness, correctness,
 * completeness, and language match (1–5 each), and flags hallucination. This
 * measures ANSWER quality — not just whether retrieval found something — so
 * regressions in the actual reply are caught and tracked over time.
 */
export interface AnswerGrade {
  groundedness: number;
  correctness: number;
  completeness: number;
  languageMatch: number;
  hallucination: boolean;
  /** 0–100 overall quality score. */
  score: number;
  verdict: 'pass' | 'fail';
  rationale: string;
  /** Specific "add/update X in Y place" instruction for weak answers (else ''). */
  fix: string;
}

const FAILED_GRADE: AnswerGrade = {
  groundedness: 0,
  correctness: 0,
  completeness: 0,
  languageMatch: 0,
  hallucination: false,
  score: 0,
  verdict: 'fail',
  rationale: 'Could not grade the answer.',
  fix: '',
};

function clamp5(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, v));
}

function parseGrade(raw: string): AnswerGrade {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return FAILED_GRADE;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return FAILED_GRADE;
  }
  const groundedness = clamp5(obj.groundedness);
  const correctness = clamp5(obj.correctness);
  const completeness = clamp5(obj.completeness);
  const languageMatch = clamp5(obj.language_match ?? obj.languageMatch);
  const hallucination = Boolean(obj.hallucination);
  // Weight groundedness + correctness highest; hallucination caps the score.
  const weighted = (groundedness * 0.35 + correctness * 0.35 + completeness * 0.2 + languageMatch * 0.1) / 5;
  let score = Math.round(weighted * 100);
  if (hallucination) score = Math.min(score, 40);
  const verdict: 'pass' | 'fail' = !hallucination && correctness >= 3.5 && groundedness >= 3.5 ? 'pass' : 'fail';
  return {
    groundedness,
    correctness,
    completeness,
    languageMatch,
    hallucination,
    score,
    verdict,
    rationale: typeof obj.rationale === 'string' ? obj.rationale.slice(0, 400) : '',
    fix: typeof obj.fix === 'string' ? obj.fix.slice(0, 300) : '',
  };
}

export async function gradeAnswer(params: {
  question: string;
  answer: string;
  context: string;
  language: string;
  provider: AIProvider;
  model: string;
}): Promise<AnswerGrade> {
  const system = [
    'You are a strict evaluator of a customer-support AI assistant.',
    'Score the ANSWER to the QUESTION given only the CONTEXT the assistant was allowed to use.',
    'Rate each 1-5: groundedness (claims supported by CONTEXT), correctness, completeness, language_match (replied in the expected language).',
    'Set hallucination=true if the answer states business facts (prices, stock, policies) NOT present in CONTEXT.',
    'If CONTEXT is empty, a safe "I don\'t know / let me connect you to a human" answer should score HIGH on groundedness.',
    'If the answer is weak, wrong, or incomplete, set "fix" to a SPECIFIC instruction telling the business exactly what data to add or update and WHERE — e.g. "Add your return policy in Business Profile" or "Add international shipping coverage to the Knowledge Base". If the answer is good, set "fix" to "".',
    'Reply with ONLY strict JSON: {"groundedness":n,"correctness":n,"completeness":n,"language_match":n,"hallucination":bool,"rationale":"...","fix":"..."}',
  ].join(' ');

  const user = [
    `Expected language: ${params.language}`,
    `QUESTION:\n${wrapUntrusted('QUESTION', params.question)}`,
    `CONTEXT:\n${wrapUntrusted('CONTEXT', params.context || '(empty)')}`,
    `ANSWER:\n${wrapUntrusted('ANSWER', params.answer)}`,
  ].join('\n\n');

  try {
    const result = await params.provider.complete({
      model: params.model,
      temperature: 0,
      maxTokens: 320,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return parseGrade(result.text);
  } catch {
    return FAILED_GRADE;
  }
}
