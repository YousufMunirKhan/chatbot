import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

const USD_TO_GBP = 0.8;
const CUSTOMER_AI_MARKUP = 2.5;
const MIN_AI_CHARGE_GBP = 0.001;

function roundMoney(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function customerAiChargeGbp(providerCostUsd: number): number {
  if (!Number.isFinite(providerCostUsd) || providerCostUsd <= 0) return 0;
  return roundMoney(Math.max(MIN_AI_CHARGE_GBP, providerCostUsd * USD_TO_GBP * CUSTOMER_AI_MARKUP));
}

export async function getAiCreditAccess(companyId: string): Promise<{
  tracked: boolean;
  allowed: boolean;
  balance: number | null;
}> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('company_credit_accounts')
    .select('balance_amount')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    logger.warn('Failed to read AI credit access', { companyId, error: error.message });
    return { tracked: false, allowed: true, balance: null };
  }
  if (!data) return { tracked: false, allowed: true, balance: null };
  const balance = Number(data.balance_amount ?? 0);
  return { tracked: true, allowed: balance > 0, balance };
}

export async function deductAiCreditForUsage(params: {
  companyId: string;
  aiUsageLogId: string | null;
  providerCostUsd: number;
  operationType: string;
  model: string;
}): Promise<void> {
  const charge = customerAiChargeGbp(params.providerCostUsd);
  if (charge <= 0) return;

  const sb = createSupabaseServiceClient();
  const { data: account, error: accountError } = await sb
    .from('company_credit_accounts')
    .select('balance_amount,lifetime_usage_charged')
    .eq('company_id', params.companyId)
    .maybeSingle();

  if (accountError) throw accountError;
  if (!account) return;

  const nextBalance = roundMoney(Number(account.balance_amount ?? 0) - charge);
  const nextLifetimeUsage = roundMoney(Number(account.lifetime_usage_charged ?? 0) + charge);

  const { error: updateError } = await sb
    .from('company_credit_accounts')
    .update({
      balance_amount: nextBalance,
      lifetime_usage_charged: nextLifetimeUsage,
    })
    .eq('company_id', params.companyId);
  if (updateError) throw updateError;

  const { error: txError } = await sb.from('company_credit_transactions').insert({
    company_id: params.companyId,
    type: 'ai_usage',
    amount: -charge,
    currency: 'GBP',
    provider_cost_usd: roundMoney(params.providerCostUsd, 6),
    ai_usage_log_id: params.aiUsageLogId,
    description: `AI ${params.operationType} usage`,
    metadata_json: {
      model: params.model,
      customerMarkup: CUSTOMER_AI_MARKUP,
      usdToGbp: USD_TO_GBP,
    },
  });
  if (txError) throw txError;
}
