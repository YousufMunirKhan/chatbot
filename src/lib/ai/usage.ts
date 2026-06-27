import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { deductAiCreditForUsage } from '@/lib/billing/credits';

/**
 * AI usage + cost logging (Module 20). Every AI call records tokens and an
 * estimated cost into ai_usage_logs, powering company analytics and the
 * super-admin profit/loss view.
 */
type Operation = 'chat' | 'embedding' | 'rerank' | 'contextualize' | 'tool_call';

// USD per 1M tokens [input, output]. Matched by model-name substring.
const PRICING: Array<[RegExp, number, number]> = [
  [/gpt-4o-mini/i, 0.15, 0.6],
  [/gpt-4o/i, 2.5, 10],
  [/text-embedding-3-large/i, 0.13, 0],
  [/text-embedding-3-small/i, 0.02, 0],
  [/claude.*haiku/i, 1, 5],
  [/claude.*sonnet/i, 3, 15],
  [/claude.*opus/i, 15, 75],
];

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const match = PRICING.find(([re]) => re.test(model));
  if (!match) return 0;
  const [, inP, outP] = match;
  return (inputTokens / 1_000_000) * inP + (outputTokens / 1_000_000) * outP;
}

export async function logAiUsage(params: {
  companyId: string;
  botId?: string | null;
  conversationId?: string | null;
  provider: string;
  model: string;
  operationType: Operation;
  inputTokens: number;
  outputTokens: number;
}): Promise<{ usageLogId: string | null; estimatedCost: number }> {
  const estimatedCost = estimateCost(params.model, params.inputTokens, params.outputTokens);
  try {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from('ai_usage_logs')
      .insert({
        company_id: params.companyId,
        bot_id: params.botId ?? null,
        conversation_id: params.conversationId ?? null,
        provider: params.provider,
        model: params.model,
        operation_type: params.operationType,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        estimated_cost: estimatedCost,
      })
      .select('id')
      .single();
    if (error) throw error;

    try {
      await deductAiCreditForUsage({
        companyId: params.companyId,
        aiUsageLogId: (data?.id as string) ?? null,
        providerCostUsd: estimatedCost,
        operationType: params.operationType,
        model: params.model,
      });
    } catch (creditErr) {
      logger.warn('Failed to deduct AI credit', {
        companyId: params.companyId,
        error: creditErr instanceof Error ? creditErr.message : String(creditErr),
      });
    }
    return { usageLogId: (data?.id as string) ?? null, estimatedCost };
  } catch (err) {
    // Never let usage logging break a chat turn.
    logger.warn('Failed to log AI usage', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { usageLogId: null, estimatedCost };
  }
}
