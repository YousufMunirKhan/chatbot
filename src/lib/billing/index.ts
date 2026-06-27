import { createSupabaseServiceClient } from '@/lib/db/server';
import { PlanLimitError } from '@/lib/errors';

/**
 * Billing & plan enforcement (Module 19). Super-admin overrides on the
 * subscription (free_until, custom limits, suspended) take precedence over the
 * Stripe-derived plan.
 */
export type LimitedAction =
  | 'ai_message'
  | 'create_bot'
  | 'create_agent'
  | 'create_integration'
  | 'place_order'
  | 'ingest';

export interface PlanState {
  plan: string | null;
  status: string;
  freeUntil: string | null;
  messageLimit: number | null;
  botLimit: number | null;
  agentLimit: number | null;
  integrationLimit: number | null;
}

export async function getSubscription(companyId: string): Promise<PlanState | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('subscriptions')
    .select('plan, status, free_until, message_limit, bot_limit, agent_limit, integration_limit')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    plan: (d.plan as string) ?? null,
    status: d.status as string,
    freeUntil: (d.free_until as string) ?? null,
    messageLimit: (d.message_limit as number) ?? null,
    botLimit: (d.bot_limit as number) ?? null,
    agentLimit: (d.agent_limit as number) ?? null,
    integrationLimit: (d.integration_limit as number) ?? null,
  };
}

export async function planAllowsAdvancedModel(companyId: string): Promise<boolean> {
  const sub = await getSubscription(companyId);
  return sub?.plan === 'growth' || sub?.plan === 'pro' || sub?.plan === 'custom';
}

/** Messages (AI chat operations) used in the current calendar month. */
export async function getMonthlyMessageCount(companyId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await sb
    .from('ai_usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('operation_type', 'chat')
    .gte('created_at', since.toISOString());
  return count ?? 0;
}

/** True if the company may still send an AI message (under limit + not suspended). */
export async function withinMessageQuota(companyId: string): Promise<boolean> {
  const sub = await getSubscription(companyId);
  if (!sub) return true;
  if (sub.status === 'suspended') return false;
  if (sub.messageLimit == null) return true;
  const used = await getMonthlyMessageCount(companyId);
  return used < sub.messageLimit;
}

/** Throwing guard for dashboard create actions. */
export async function assertWithinPlan(companyId: string, action: LimitedAction): Promise<void> {
  const sub = await getSubscription(companyId);
  if (!sub) return;
  if (sub.status === 'suspended') throw new PlanLimitError('This account is suspended.');

  const sb = createSupabaseServiceClient();
  const countWhere = async (table: string) => {
    const { count } = await sb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId);
    return count ?? 0;
  };

  if (action === 'create_bot' && sub.botLimit != null && (await countWhere('bots')) >= sub.botLimit) {
    throw new PlanLimitError(`Your plan allows up to ${sub.botLimit} assistant(s).`);
  }
  if (action === 'create_integration' && sub.integrationLimit != null && (await countWhere('integration_accounts')) >= sub.integrationLimit) {
    throw new PlanLimitError(`Your plan allows up to ${sub.integrationLimit} integration(s).`);
  }
  if (action === 'create_agent' && sub.agentLimit != null) {
    const { count } = await sb
      .from('company_users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('role', 'agent');
    const { count: pending } = await sb
      .from('agent_invites')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    if ((count ?? 0) + (pending ?? 0) >= sub.agentLimit) {
      throw new PlanLimitError(`Your plan allows up to ${sub.agentLimit} agent(s).`);
    }
  }
}
