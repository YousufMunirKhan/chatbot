import { createSupabaseServiceClient } from '@/lib/db/server';
import { estimateCost } from '@/lib/ai/usage';
import { redactPII } from '@/lib/ai/safety';
import { logger } from '@/lib/logger';

export type AnswerFailureReason =
  | 'missing_info'
  | 'weak_retrieval'
  | 'tool_failed'
  | 'human_needed'
  | 'model_error'
  | 'none';

export interface QualityRetrievedChunk {
  id: string;
  documentId: string;
  score: number;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function inferFailureReason(params: {
  answer: string;
  retrievedCount: number;
  toolCalls: string[];
  error?: string | null;
  humanActive?: boolean;
}): AnswerFailureReason {
  if (params.error) return 'model_error';
  if (params.humanActive) return 'human_needed';
  const lower = params.answer.toLowerCase();
  if (lower.includes("don't know") || lower.includes('do not know') || lower.includes('not available')) {
    return params.retrievedCount === 0 ? 'missing_info' : 'weak_retrieval';
  }
  if (lower.includes('tool failed') || lower.includes('could not')) return 'tool_failed';
  return 'none';
}

export async function logAnswerQuality(params: {
  companyId: string;
  botId: string | null;
  conversationId: string;
  visitorMessageId?: string | null;
  assistantMessageId?: string | null;
  question: string;
  answer: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retrievedChunks: QualityRetrievedChunk[];
  toolsCalled: string[];
  sourceTypes: string[];
  handoffStatus?: 'none' | 'suggested' | 'needs_human' | 'human_active';
  failureReason?: AnswerFailureReason;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const retrievalScore = params.retrievedChunks.length
      ? Math.max(...params.retrievedChunks.map((c) => Number(c.score) || 0))
      : null;
    const failure = params.failureReason && params.failureReason !== 'none' ? params.failureReason : null;
    await sb.from('answer_quality_logs').insert({
      company_id: params.companyId,
      bot_id: params.botId,
      conversation_id: params.conversationId,
      visitor_message_id: params.visitorMessageId ?? null,
      assistant_message_id: params.assistantMessageId ?? null,
      question: redactPII(params.question),
      answer: redactPII(params.answer),
      provider: params.provider,
      model: params.model,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      estimated_cost: estimateCost(params.model, params.inputTokens, params.outputTokens),
      latency_ms: params.latencyMs,
      retrieved_chunks: params.retrievedChunks,
      tools_called: uniq(params.toolsCalled),
      source_types: uniq(params.sourceTypes),
      retrieval_score: retrievalScore,
      confidence_score: retrievalScore,
      handoff_status: params.handoffStatus ?? 'none',
      failure_reason: failure,
      metadata_json: params.metadata ?? {},
    });
  } catch (err) {
    logger.warn('Failed to log answer quality', {
      error: err instanceof Error ? err.message : String(err),
      companyId: params.companyId,
    });
  }
}
