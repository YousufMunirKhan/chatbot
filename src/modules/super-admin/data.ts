import { unstable_noStore as noStore } from 'next/cache';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { PLANS } from './plans';

/**
 * Super-admin data layer (Module 4). Uses the service-role client (bypasses RLS)
 * for cross-company platform views. ALWAYS call requireRole([SUPER_ADMIN]) in the
 * page/layout before invoking these.
 *
 * AI cost is summed from `ai_usage_logs` (Module 20) for the current month.
 */

// PostgREST returns to-one embeds as an object and to-many as arrays; normalize.
const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const countOf = (v: unknown): number => {
  if (Array.isArray(v)) return (v[0] as { count?: number })?.count ?? 0;
  return (v as { count?: number })?.count ?? 0;
};

export interface CompanyRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  plan: string | null;
  subStatus: string | null;
  freeUntil: string | null;
  messageLimit: number | null;
  botCount: number;
  memberCount: number;
}

export async function listCompanies(): Promise<CompanyRow[]> {
  noStore();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('companies')
    .select(
      'id,name,status,created_at, subscriptions(plan,status,free_until,message_limit), bots(count), company_users(count)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((c: Record<string, unknown>) => {
    const sub = (one(c.subscriptions) ?? {}) as {
      plan?: string;
      status?: string;
      free_until?: string;
      message_limit?: number;
    };
    return {
      id: c.id as string,
      name: c.name as string,
      status: c.status as string,
      createdAt: c.created_at as string,
      plan: sub.plan ?? null,
      subStatus: sub.status ?? null,
      freeUntil: sub.free_until ?? null,
      messageLimit: sub.message_limit ?? null,
      botCount: countOf(c.bots),
      memberCount: countOf(c.company_users),
    };
  });
}

function monthlyRevenue(row: CompanyRow): number {
  if (row.status !== 'active' || !row.plan) return 0;
  if (row.subStatus === 'trialing') return 0;
  return row.plan in PLANS ? PLANS[row.plan as keyof typeof PLANS].priceMonthly : 0;
}

export interface FinancialRow extends CompanyRow {
  revenue: number;
  aiCost: number;
  profit: number;
}

/**
 * Sum of `ai_usage_logs.estimated_cost` for the current calendar month, grouped
 * by company_id. Rows are fetched and reduced in JS (PostgREST has no GROUP BY).
 */
export async function getAiCostByCompany(): Promise<Record<string, number>> {
  noStore();
  const sb = createSupabaseServiceClient();
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await sb
    .from('ai_usage_logs')
    .select('company_id,estimated_cost')
    .gte('created_at', since.toISOString());
  if (error) throw error;
  return (data ?? []).reduce<Record<string, number>>((acc, r) => {
    const row = r as Record<string, unknown>;
    const id = row.company_id as string;
    if (!id) return acc;
    acc[id] = (acc[id] ?? 0) + ((row.estimated_cost as number) ?? 0);
    return acc;
  }, {});
}

export async function listFinancials(): Promise<FinancialRow[]> {
  const [companies, costByCompany] = await Promise.all([listCompanies(), getAiCostByCompany()]);
  return companies.map((c) => {
    const revenue = monthlyRevenue(c);
    const aiCost = costByCompany[c.id] ?? 0;
    return { ...c, revenue, aiCost, profit: revenue - aiCost };
  });
}

export async function getOverviewStats() {
  const [companies, costByCompany] = await Promise.all([listCompanies(), getAiCostByCompany()]);
  const mrr = companies.reduce((s, c) => s + monthlyRevenue(c), 0);
  const aiCost = companies.reduce((s, c) => s + (costByCompany[c.id] ?? 0), 0);
  return {
    total: companies.length,
    active: companies.filter((c) => c.status === 'active').length,
    suspended: companies.filter((c) => c.status === 'suspended').length,
    trialing: companies.filter((c) => c.subStatus === 'trialing' || c.plan === 'free_trial').length,
    bots: companies.reduce((s, c) => s + c.botCount, 0),
    mrr,
    aiCost,
    profit: mrr - aiCost,
    recent: companies.slice(0, 5),
  };
}

export interface SubscriptionInfo {
  plan: string | null;
  status: string | null;
  freeUntil: string | null;
  messageLimit: number | null;
  agentLimit: number | null;
  botLimit: number | null;
  integrationLimit: number | null;
}

export interface CompanyDetail {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  defaultLanguage: string;
  status: string;
  createdAt: string;
  subscription: SubscriptionInfo;
  members: { role: string; email: string | null; fullName: string | null }[];
  bots: { id: string; name: string; botType: string; aiEnabled: boolean; publicBotId: string }[];
  audits: { action: string; createdAt: string; actorEmail: string | null }[];
  creditAccount: {
    balanceAmount: number;
    currency: string;
    lifetimeCreditAdded: number;
    lifetimeUsageCharged: number;
    lowBalanceThreshold: number;
  } | null;
  creditTransactions: {
    id: string;
    type: string;
    amount: number;
    currency: string;
    description: string | null;
    providerCostUsd: number | null;
    createdAt: string;
  }[];
  addons: { key: string; label: string; priceMonthly: number; currency: string; status: string }[];
  commercialCharges: {
    chargeType: string;
    amount: number;
    currency: string;
    status: string;
    description: string | null;
    createdAt: string;
  }[];
  counts?: {
    documents: number;
    quickActions: number;
    leads: number;
    appointments: number;
    integrations: number;
    qualityIssues: number;
  };
}

const rec = (v: unknown): Record<string, unknown> => (one(v) ?? {}) as Record<string, unknown>;

export async function getCompanyDetail(id: string): Promise<CompanyDetail | null> {
  noStore();
  const sb = createSupabaseServiceClient();
  const { data: company, error } = await sb
    .from('companies')
    .select('*, subscriptions(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!company) return null;
  const c = company as Record<string, unknown>;
  const sub = rec(c.subscriptions);

  const [
    { data: bots },
    { data: members },
    { data: audits },
    { data: creditAccount },
    { data: creditTransactions },
    { data: addons },
    { data: commercialCharges },
    documents,
    quickActions,
    leads,
    appointments,
    integrations,
    qualityIssues,
  ] = await Promise.all([
    sb
      .from('bots')
      .select('id,name,bot_type,ai_enabled,public_bot_id,created_at')
      .eq('company_id', id)
      .order('created_at', { ascending: false }),
    sb.from('company_users').select('role, users(email, full_name)').eq('company_id', id),
    sb
      .from('audit_logs')
      .select('action,created_at, users(email)')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(15),
    sb
      .from('company_credit_accounts')
      .select(
        'balance_amount,currency,lifetime_credit_added,lifetime_usage_charged,low_balance_threshold',
      )
      .eq('company_id', id)
      .maybeSingle(),
    sb
      .from('company_credit_transactions')
      .select('id,type,amount,currency,description,provider_cost_usd,created_at')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(8),
    sb
      .from('company_addons')
      .select('key,label,price_monthly,currency,status')
      .eq('company_id', id)
      .order('created_at', { ascending: false }),
    sb
      .from('company_commercial_charges')
      .select('charge_type,amount,currency,status,description,created_at')
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(8),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', id),
    sb.from('bot_quick_actions').select('id', { count: 'exact', head: true }).eq('company_id', id),
    sb.from('leads').select('id', { count: 'exact', head: true }).eq('company_id', id),
    sb.from('appointments').select('id', { count: 'exact', head: true }).eq('company_id', id),
    sb
      .from('integration_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', id),
    sb
      .from('answer_quality_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', id)
      .not('failure_reason', 'is', null),
  ]);

  return {
    id: c.id as string,
    name: c.name as string,
    website: (c.website as string) ?? null,
    country: (c.country as string) ?? null,
    defaultLanguage: c.default_language as string,
    status: c.status as string,
    createdAt: c.created_at as string,
    subscription: {
      plan: (sub.plan as string) ?? null,
      status: (sub.status as string) ?? null,
      freeUntil: (sub.free_until as string) ?? null,
      messageLimit: (sub.message_limit as number) ?? null,
      agentLimit: (sub.agent_limit as number) ?? null,
      botLimit: (sub.bot_limit as number) ?? null,
      integrationLimit: (sub.integration_limit as number) ?? null,
    },
    members: (members ?? []).map((m) => {
      const u = rec((m as Record<string, unknown>).users);
      return {
        role: (m as Record<string, unknown>).role as string,
        email: (u.email as string) ?? null,
        fullName: (u.full_name as string) ?? null,
      };
    }),
    bots: (bots ?? []).map((b) => {
      const x = b as Record<string, unknown>;
      return {
        id: x.id as string,
        name: x.name as string,
        botType: x.bot_type as string,
        aiEnabled: Boolean(x.ai_enabled),
        publicBotId: x.public_bot_id as string,
      };
    }),
    audits: (audits ?? []).map((a) => {
      const x = a as Record<string, unknown>;
      return {
        action: x.action as string,
        createdAt: x.created_at as string,
        actorEmail: (rec(x.users).email as string) ?? null,
      };
    }),
    creditAccount: creditAccount
      ? {
          balanceAmount: Number((creditAccount as Record<string, unknown>).balance_amount ?? 0),
          currency: ((creditAccount as Record<string, unknown>).currency as string) ?? 'GBP',
          lifetimeCreditAdded: Number(
            (creditAccount as Record<string, unknown>).lifetime_credit_added ?? 0,
          ),
          lifetimeUsageCharged: Number(
            (creditAccount as Record<string, unknown>).lifetime_usage_charged ?? 0,
          ),
          lowBalanceThreshold: Number(
            (creditAccount as Record<string, unknown>).low_balance_threshold ?? 0,
          ),
        }
      : null,
    creditTransactions: (creditTransactions ?? []).map((tx) => {
      const x = tx as Record<string, unknown>;
      return {
        id: x.id as string,
        type: x.type as string,
        amount: Number(x.amount ?? 0),
        currency: (x.currency as string) ?? 'GBP',
        description: (x.description as string) ?? null,
        providerCostUsd: x.provider_cost_usd == null ? null : Number(x.provider_cost_usd),
        createdAt: x.created_at as string,
      };
    }),
    addons: (addons ?? []).map((addon) => {
      const x = addon as Record<string, unknown>;
      return {
        key: x.key as string,
        label: x.label as string,
        priceMonthly: Number(x.price_monthly ?? 0),
        currency: (x.currency as string) ?? 'GBP',
        status: x.status as string,
      };
    }),
    commercialCharges: (commercialCharges ?? []).map((charge) => {
      const x = charge as Record<string, unknown>;
      return {
        chargeType: x.charge_type as string,
        amount: Number(x.amount ?? 0),
        currency: (x.currency as string) ?? 'GBP',
        status: x.status as string,
        description: (x.description as string) ?? null,
        createdAt: x.created_at as string,
      };
    }),
    counts: {
      documents: documents.count ?? 0,
      quickActions: quickActions.count ?? 0,
      leads: leads.count ?? 0,
      appointments: appointments.count ?? 0,
      integrations: integrations.count ?? 0,
      qualityIssues: qualityIssues.count ?? 0,
    },
  };
}

export interface AuditRow {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string | null;
  companyName: string | null;
}

export async function listAuditLogs(limit = 100): Promise<AuditRow[]> {
  noStore();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('audit_logs')
    .select('id,action,created_at, users(email), companies(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((l) => {
    const x = l as Record<string, unknown>;
    return {
      id: x.id as string,
      action: x.action as string,
      createdAt: x.created_at as string,
      actorEmail: (rec(x.users).email as string) ?? null,
      companyName: (rec(x.companies).name as string) ?? null,
    };
  });
}
