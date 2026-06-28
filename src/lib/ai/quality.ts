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

type AutoAuditStatus = 'perfect' | 'acceptable' | 'needs_review' | 'failed';
type AutoAuditLabel =
  | 'perfect'
  | 'acceptable'
  | 'missing_info'
  | 'wrong_answer'
  | 'weak_retrieval'
  | 'hallucination_risk'
  | 'needs_human'
  | 'too_slow'
  | 'tool_failed'
  | 'model_error'
  | 'bad_tone';

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

function autoAudit(params: {
  failureReason?: AnswerFailureReason;
  retrievalScore: number | null;
  latencyMs: number;
  handoffStatus?: 'none' | 'suggested' | 'needs_human' | 'human_active';
  toolsCalled: string[];
}): {
  status: AutoAuditStatus;
  score: number;
  label: AutoAuditLabel;
  reason: string;
  suggestedFix: string | null;
} {
  const failure = params.failureReason && params.failureReason !== 'none' ? params.failureReason : null;
  if (failure === 'model_error') {
    return {
      status: 'failed',
      score: 20,
      label: 'model_error',
      reason: 'The model call failed or produced an unusable response.',
      suggestedFix: 'Check the AI provider configuration and retry the conversation after fixing the error.',
    };
  }
  if (failure === 'tool_failed') {
    return {
      status: 'failed',
      score: 40,
      label: 'tool_failed',
      reason: 'A connected tool or integration appears to have failed.',
      suggestedFix: 'Check the integration/tool setup and verify the required fields for this workflow.',
    };
  }
  if (failure === 'missing_info') {
    return {
      status: 'needs_review',
      score: 45,
      label: 'missing_info',
      reason: 'The assistant could not find enough company information to answer.',
      suggestedFix: 'Add the missing answer to the company knowledge base, FAQ, policy, product, or service data.',
    };
  }
  if (failure === 'weak_retrieval') {
    return {
      status: 'needs_review',
      score: 55,
      label: 'weak_retrieval',
      reason: 'Knowledge was found, but the retrieved context was probably weak or incomplete.',
      suggestedFix: 'Improve or re-index the relevant knowledge source so search can retrieve a stronger answer.',
    };
  }
  if (failure === 'human_needed' || params.handoffStatus === 'needs_human' || params.handoffStatus === 'human_active') {
    return {
      status: 'needs_review',
      score: 50,
      label: 'needs_human',
      reason: 'The conversation needs human attention or the assistant should escalate sooner.',
      suggestedFix: 'Review escalation rules and add guidance for when this topic should go to a human agent.',
    };
  }
  if (params.latencyMs > 15_000) {
    return {
      status: 'needs_review',
      score: 65,
      label: 'too_slow',
      reason: 'The answer was likely too slow for a live chat experience.',
      suggestedFix: 'Check retrieval/tool latency and consider reducing tool calls or improving indexes for this company.',
    };
  }

  const retrievalScore = params.retrievalScore ?? 0;
  const usedGrounding = retrievalScore > 0 || params.toolsCalled.length > 0;
  if (usedGrounding && retrievalScore >= 0.75) {
    return {
      status: 'perfect',
      score: 95,
      label: 'perfect',
      reason: 'The answer used strong grounding and no automatic issue was detected.',
      suggestedFix: null,
    };
  }
  return {
    status: 'acceptable',
    score: usedGrounding ? 86 : 80,
    label: 'acceptable',
    reason: usedGrounding
      ? 'No automatic issue detected.'
      : 'No automatic issue detected, but the answer had little explicit retrieved grounding.',
    suggestedFix: null,
  };
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
    const audit = autoAudit({
      failureReason: params.failureReason,
      retrievalScore,
      latencyMs: params.latencyMs,
      handoffStatus: params.handoffStatus,
      toolsCalled: params.toolsCalled,
    });
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
      auto_audit_status: audit.status,
      auto_audit_score: audit.score,
      auto_audit_label: audit.label,
      auto_audit_reason: audit.reason,
      suggested_fix: audit.suggestedFix,
      metadata_json: params.metadata ?? {},
    });
  } catch (err) {
    logger.warn('Failed to log answer quality', {
      error: err instanceof Error ? err.message : String(err),
      companyId: params.companyId,
    });
  }
}
