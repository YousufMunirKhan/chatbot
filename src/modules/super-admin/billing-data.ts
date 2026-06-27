import { createSupabaseServiceClient } from '@/lib/db/server';
import { getMonthlyMessageCount } from '@/lib/billing';
import { getAiCostByCompany, listCompanies } from './data';

export interface StripePriceMapping {
  plan: string;
  stripePriceId: string;
  overagePriceId: string | null;
  enabled: boolean;
}

export interface BillingPlan {
  key: string;
  label: string;
  description: string;
  priceMonthlyGbp: number;
  messageLimit: number | null;
  botLimit: number | null;
  agentLimit: number | null;
  integrationLimit: number | null;
  includedCreditGbp: number;
  trialDays: number | null;
  isPublic: boolean;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface BillingPlanWithStripe extends BillingPlan {
  stripePriceId: string | null;
  overagePriceId: string | null;
  stripeEnabled: boolean;
}

function mapPlan(row: Record<string, unknown>): BillingPlan {
  return {
    key: row.key as string,
    label: row.label as string,
    description: (row.description as string) ?? '',
    priceMonthlyGbp: Number(row.price_monthly_gbp ?? 0),
    messageLimit: row.message_limit == null ? null : Number(row.message_limit),
    botLimit: row.bot_limit == null ? null : Number(row.bot_limit),
    agentLimit: row.agent_limit == null ? null : Number(row.agent_limit),
    integrationLimit: row.integration_limit == null ? null : Number(row.integration_limit),
    includedCreditGbp: Number(row.included_credit_gbp ?? 0),
    trialDays: row.trial_days == null ? null : Number(row.trial_days),
    isPublic: row.is_public !== false,
    isDefault: Boolean(row.is_default),
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 100),
  };
}

export async function listBillingPlans(
  options: { publicOnly?: boolean } = {},
): Promise<BillingPlan[]> {
  let query = createSupabaseServiceClient()
    .from('billing_plans')
    .select(
      'key,label,description,price_monthly_gbp,message_limit,bot_limit,agent_limit,integration_limit,included_credit_gbp,trial_days,is_public,is_default,is_active,sort_order',
    )
    .order('sort_order', { ascending: true });
  if (options.publicOnly) query = query.eq('is_public', true).eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapPlan);
}

export async function getBillingPlan(key: string): Promise<BillingPlan | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('billing_plans')
    .select(
      'key,label,description,price_monthly_gbp,message_limit,bot_limit,agent_limit,integration_limit,included_credit_gbp,trial_days,is_public,is_default,is_active,sort_order',
    )
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPlan(data as Record<string, unknown>) : null;
}

export async function listBillingPlansWithStripe(): Promise<BillingPlanWithStripe[]> {
  const [plans, mappings] = await Promise.all([listBillingPlans(), listStripePriceMappings()]);
  const byPlan = new Map(mappings.map((mapping) => [mapping.plan, mapping]));
  return plans.map((plan) => {
    const mapping = byPlan.get(plan.key);
    return {
      ...plan,
      stripePriceId: mapping?.stripePriceId ?? null,
      overagePriceId: mapping?.overagePriceId ?? null,
      stripeEnabled: mapping?.enabled ?? false,
    };
  });
}

export async function listStripePriceMappings(): Promise<StripePriceMapping[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('stripe_price_mappings')
    .select('plan,stripe_price_id,overage_price_id,enabled')
    .order('plan', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    plan: row.plan as string,
    stripePriceId: row.stripe_price_id as string,
    overagePriceId: (row.overage_price_id as string) ?? null,
    enabled: Boolean(row.enabled),
  }));
}

export async function getCompanyPlanUsageSummary(): Promise<
  Array<{
    companyId: string;
    companyName: string;
    plan: string | null;
    messageLimit: number | null;
    usedMessages: number;
    aiCostUsd: number;
    planRevenueGbp: number;
    risk: 'ok' | 'watch' | 'loss';
  }>
> {
  const [companies, costByCompany, plansList] = await Promise.all([
    listCompanies(),
    getAiCostByCompany(),
    listBillingPlans(),
  ]);
  const plans = new Map(plansList.map((plan) => [plan.key, plan]));
  const rows = await Promise.all(
    companies.map(async (company) => {
      const planKey = company.plan;
      const plan = planKey ? plans.get(planKey) : null;
      const aiCostUsd = costByCompany[company.id] ?? 0;
      const revenue = company.subStatus === 'trialing' ? 0 : (plan?.priceMonthlyGbp ?? 0);
      const risk: 'ok' | 'watch' | 'loss' =
        revenue <= 0 && aiCostUsd > 0.5
          ? 'loss'
          : aiCostUsd * 0.8 > revenue * 0.35
            ? 'watch'
            : 'ok';
      return {
        companyId: company.id,
        companyName: company.name,
        plan: planKey,
        messageLimit: company.messageLimit,
        usedMessages: await getMonthlyMessageCount(company.id),
        aiCostUsd,
        planRevenueGbp: revenue,
        risk,
      };
    }),
  );
  return rows.sort((a, b) => b.aiCostUsd - a.aiCostUsd).slice(0, 8);
}
