import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getSessionUser, homePathFor } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { NotFoundError } from '@/lib/errors';

/**
 * Company-scoped data layer (Module 5). Every query is bound to the SESSION
 * user's own `companyId` — never a value from the request — so a company admin
 * can only ever touch their own company's data (Access Rule: "Company admin can
 * only access own company").
 *
 * If the user has no company (e.g. a super admin), they are redirected to their
 * own home instead of crashing the page.
 */
export const getCompanyId = cache(async function getCompanyId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!user.companyId) redirect(homePathFor(user));
  return user.companyId;
});

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
const rec = (v: unknown): Record<string, unknown> => (one(v) ?? {}) as Record<string, unknown>;

export interface SubscriptionInfo {
  plan: string | null;
  status: string | null;
  freeUntil: string | null;
  messageLimit: number | null;
  agentLimit: number | null;
  botLimit: number | null;
  integrationLimit: number | null;
}

export interface CompanyProfile {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  timezone: string | null;
  defaultLanguage: string;
  status: string;
  subscription: SubscriptionInfo;
}

export async function getCurrentCompany(): Promise<CompanyProfile> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('companies')
    .select('*, subscriptions(*)')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Company not found.');
  const c = data as Record<string, unknown>;
  const s = rec(c.subscriptions);
  return {
    id: c.id as string,
    name: c.name as string,
    website: (c.website as string) ?? null,
    country: (c.country as string) ?? null,
    timezone: (c.timezone as string) ?? null,
    defaultLanguage: c.default_language as string,
    status: c.status as string,
    subscription: {
      plan: (s.plan as string) ?? null,
      status: (s.status as string) ?? null,
      freeUntil: (s.free_until as string) ?? null,
      messageLimit: (s.message_limit as number) ?? null,
      agentLimit: (s.agent_limit as number) ?? null,
      botLimit: (s.bot_limit as number) ?? null,
      integrationLimit: (s.integration_limit as number) ?? null,
    },
  };
}

export interface BotRow {
  id: string;
  name: string;
  botType: string;
  languageDefault: string;
  aiEnabled: boolean;
  capabilityFlags: string[];
  assistantAudience: 'customer' | 'internal';
  publicBotId: string;
  domainAllowlist: string[];
  appearance: Record<string, unknown>;
  createdAt: string;
}

function mapBot(b: Record<string, unknown>): BotRow {
  return {
    id: b.id as string,
    name: b.name as string,
    botType: b.bot_type as string,
    languageDefault: b.language_default as string,
    aiEnabled: Boolean(b.ai_enabled),
    capabilityFlags: (b.capability_flags as string[]) ?? [],
    assistantAudience:
      ((b.appearance_json as Record<string, unknown> | null)?.assistantAudience as 'customer' | 'internal' | undefined) ??
      'customer',
    publicBotId: b.public_bot_id as string,
    domainAllowlist: (b.domain_allowlist as string[]) ?? [],
    appearance: (b.appearance_json as Record<string, unknown>) ?? {},
    createdAt: b.created_at as string,
  };
}

export async function listBots(): Promise<BotRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('bots')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((b) => mapBot(b as Record<string, unknown>));
}

export async function getBot(botId: string): Promise<BotRow | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('bots')
    .select('*')
    .eq('company_id', companyId) // scope prevents cross-company access
    .eq('id', botId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapBot(data as Record<string, unknown>) : null;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  presenceStatus?: string | null;
}

export interface AgentInviteRow {
  id: string;
  email: string;
  fullName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  lastSentAt: string | null;
}

export async function listMembers(): Promise<MemberRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('company_users')
    .select('id, user_id, role, users(email, full_name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows: MemberRow[] = (data ?? []).map((m) => {
    const x = m as Record<string, unknown>;
    const u = rec(x.users);
    return {
      membershipId: x.id as string,
      userId: x.user_id as string,
      email: (u.email as string) ?? null,
      fullName: (u.full_name as string) ?? null,
      role: x.role as string,
    };
  });
  const userIds = rows.map((r) => r.userId);
  if (userIds.length) {
    const { data: presence } = await sb
      .from('agent_presence')
      .select('user_id,status')
      .eq('company_id', companyId)
      .in('user_id', userIds);
    const byUser = new Map((presence ?? []).map((p) => [p.user_id as string, p.status as string]));
    rows.forEach((row) => {
      row.presenceStatus = byUser.get(row.userId) ?? 'offline';
    });
  }
  return rows;
}

export async function listAgentInvites(): Promise<AgentInviteRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('agent_invites')
    .select('id,email,full_name,expires_at,accepted_at,revoked_at,last_sent_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((invite) => {
    const x = invite as Record<string, unknown>;
    return {
      id: x.id as string,
      email: x.email as string,
      fullName: (x.full_name as string) ?? null,
      expiresAt: x.expires_at as string,
      acceptedAt: (x.accepted_at as string) ?? null,
      revokedAt: (x.revoked_at as string) ?? null,
      lastSentAt: (x.last_sent_at as string) ?? null,
    };
  });
}

export async function getCompanyOverview() {
  const [company, bots, members] = await Promise.all([getCurrentCompany(), listBots(), listMembers()]);
  return {
    company,
    botCount: bots.length,
    agentCount: members.filter((m) => m.role === 'agent').length,
    memberCount: members.length,
    bots: bots.slice(0, 5),
  };
}
