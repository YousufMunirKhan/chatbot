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

export interface ReplyGrantRow {
  id: string;
  replyCount: number;
  reason: string;
  grantType: string;
  expiresAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
}

export interface ReplyAllowanceUsage {
  used: number;
  monthlyAllowance: number | null;
  extraReplies: number;
  totalAvailable: number | null;
  remaining: number | null;
  resetAt: string;
  grants: ReplyGrantRow[];
}

export function currentMonthStartIso(): string {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

export function currentMonthEndIso(): string {
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + 1, 1);
  end.setUTCHours(0, 0, 0, 0);
  return end.toISOString();
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
  const { count } = await sb
    .from('ai_usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('operation_type', 'chat')
    .gte('created_at', currentMonthStartIso());
  return count ?? 0;
}

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export async function listActiveReplyGrants(companyId: string): Promise<ReplyGrantRow[]> {
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data } = await sb
    .from('company_reply_grants')
    .select('id,reply_count,reason,grant_type,expires_at,created_at, users(email)')
    .eq('company_id', companyId)
    .or(`expires_at.is.null,expires_at.gte.${now}`)
    .order('created_at', { ascending: false });

  return (data ?? []).map((grant) => {
    const row = grant as Record<string, unknown>;
    const user = one(row.users as { email?: string } | { email?: string }[] | null);
    return {
      id: row.id as string,
      replyCount: Number(row.reply_count ?? 0),
      reason: (row.reason as string) ?? 'Manual allowance adjustment',
      grantType: (row.grant_type as string) ?? 'manual',
      expiresAt: (row.expires_at as string) ?? null,
      createdAt: row.created_at as string,
      createdByEmail: user?.email ?? null,
    };
  });
}

export async function getReplyAllowanceUsage(companyId: string): Promise<ReplyAllowanceUsage> {
  const [sub, used, grants] = await Promise.all([
    getSubscription(companyId),
    getMonthlyMessageCount(companyId),
    listActiveReplyGrants(companyId),
  ]);
  const monthlyAllowance = sub?.messageLimit ?? null;
  const extraReplies = grants.reduce((sum, grant) => sum + grant.replyCount, 0);
  const totalAvailable = monthlyAllowance == null ? null : monthlyAllowance + extraReplies;
  return {
    used,
    monthlyAllowance,
    extraReplies,
    totalAvailable,
    remaining: totalAvailable == null ? null : Math.max(0, totalAvailable - used),
    resetAt: currentMonthEndIso(),
    grants,
  };
}

/** True if the company may still send an AI message (under limit + not suspended). */
export async function withinMessageQuota(companyId: string): Promise<boolean> {
  const sub = await getSubscription(companyId);
  if (!sub) return true;
  if (sub.status === 'suspended') return false;
  if (sub.messageLimit == null) return true;
  const usage = await getReplyAllowanceUsage(companyId);
  return usage.totalAvailable == null || usage.used < usage.totalAvailable;
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
