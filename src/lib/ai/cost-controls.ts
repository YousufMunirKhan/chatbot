import crypto from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';

export function questionHash(text: string): string {
  return crypto.createHash('sha256').update(text.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex');
}

// Deictic / follow-up openers that only make sense with prior context.
const FOLLOWUP_RE =
  /^(and|so|also|but|then|what about|how about|ok|okay|yes|no|yep|nope|sure|why|why not|that one|this one|the (red|blue|green|black|white|small|large|first|second|other|same) one|نعم|لا|طيب|تمام|وماذا|و|ليش|ليه|ايه)\b/i;
// Volatile / per-customer intents whose answers must never be cached & replayed.
const VOLATILE_RE =
  /\b(order|tracking|track|my order|order number|status|where('?s| is)|delivery|shipment|refund|cancel|in stock|stock|availab|reserve|booking|my appointment|طلب|طلبي|تتبع|شحن|توصيل|استرجاع|الغاء|المخزون|متوفر|حجز|موعدي)\b/i;
// Pronouns that reference something earlier in the chat.
const DEICTIC_RE = /\b(it|its|them|they|this|that|these|those|the one|هذا|هذه|ذلك|هذي|هاي|هالـ)\b/i;

/**
 * Whether a question is safe to answer from cache (Issue #2): self-contained,
 * not a follow-up, and not a volatile/per-customer intent (orders, stock,
 * bookings). Prevents context-blind replays and cross-visitor leakage.
 */
export function isCacheableQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 25 || t.length > 400) return false;
  if (FOLLOWUP_RE.test(t)) return false;
  if (VOLATILE_RE.test(t)) return false;
  if (DEICTIC_RE.test(t)) return false;
  return true;
}

export async function getMonthlyAiCost(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await sb
    .from('ai_usage_logs')
    .select('estimated_cost')
    .eq('company_id', companyId)
    .gte('created_at', since.toISOString());
  return (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost ?? 0), 0);
}

export async function getAiBudget(companyId: string): Promise<{
  monthlyBudgetUsd: number | null;
  hardStopEnabled: boolean;
  cacheEnabled: boolean;
}> {
  const { data } = await createSupabaseServiceClient()
    .from('company_ai_budgets')
    .select('monthly_budget_usd,hard_stop_enabled,cache_enabled')
    .eq('company_id', companyId)
    .maybeSingle();
  return {
    monthlyBudgetUsd: data?.monthly_budget_usd == null ? null : Number(data.monthly_budget_usd),
    hardStopEnabled: Boolean(data?.hard_stop_enabled),
    cacheEnabled: data?.cache_enabled !== false,
  };
}

export async function isAiBudgetExceeded(companyId: string): Promise<boolean> {
  const budget = await getAiBudget(companyId);
  if (!budget.hardStopEnabled || budget.monthlyBudgetUsd == null) return false;
  return (await getMonthlyAiCost(companyId)) >= budget.monthlyBudgetUsd;
}

export async function getCachedAnswer(params: {
  companyId: string;
  botId: string;
  question: string;
  /** True when the conversation already has prior turns — disables cache so
   *  context-dependent answers are never replayed (Issue #2). */
  isFollowUp?: boolean;
}): Promise<string | null> {
  const budget = await getAiBudget(params.companyId);
  if (!budget.cacheEnabled) return null;
  if (params.isFollowUp || !isCacheableQuestion(params.question)) return null;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('ai_answer_cache')
    .select('id,answer,expires_at,hit_count')
    .eq('company_id', params.companyId)
    .eq('bot_id', params.botId)
    .eq('question_hash', questionHash(params.question))
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  await sb.from('ai_answer_cache').update({ hit_count: ((data.hit_count as number | undefined) ?? 0) + 1 }).eq('id', data.id);
  return data.answer as string;
}

export async function saveCachedAnswer(params: {
  companyId: string;
  botId: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  /** Tools used to produce this answer — tool-driven answers are per-customer
   *  / volatile and are never cached (Issue #2). */
  toolsCalled?: string[];
  /** Conversation already had prior turns → answer may be context-dependent. */
  isFollowUp?: boolean;
}): Promise<void> {
  const budget = await getAiBudget(params.companyId);
  if (!budget.cacheEnabled || params.answer.length < 20) return;
  if (params.isFollowUp) return;
  if (params.toolsCalled && params.toolsCalled.length > 0) return;
  if (!isCacheableQuestion(params.question)) return;
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await createSupabaseServiceClient().from('ai_answer_cache').upsert(
    {
      company_id: params.companyId,
      bot_id: params.botId,
      question_hash: questionHash(params.question),
      answer: params.answer,
      provider: params.provider,
      model: params.model,
      expires_at: expires,
    },
    { onConflict: 'company_id,bot_id,question_hash' },
  );
}
