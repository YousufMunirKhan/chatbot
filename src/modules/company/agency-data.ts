import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getAgencyForOwner, type Agency } from '@/lib/agency';
import { currentMonthStartIso } from '@/lib/billing';

/**
 * Agency-owner view of their own sub-accounts (migration 0057).
 *
 * ACCESS: an agency is owned by exactly one user. Every read here starts from
 * the SESSION user's id, resolves the agency they own, and only then lists the
 * companies attached to it — a caller can never name an agency, so there is no
 * id to tamper with.
 */

export interface SubAccountUsage {
  companyId: string;
  name: string;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  creditBalance: number;
  /** AI operations logged this calendar month. */
  messagesThisMonth: number;
  conversations: number;
  createdAt: string;
}

/** The agency the signed-in user owns, or `null`. Gates `/company/agency`. */
export async function getOwnedAgency(): Promise<Agency | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const agency = await getAgencyForOwner(user.userId);
  // A deactivated agency still belongs to its owner — they should see why their
  // sub-accounts stopped being branded rather than get a 404.
  return agency;
}

export async function listSubAccounts(agencyId: string): Promise<SubAccountUsage[]> {
  const sb = createSupabaseServiceClient();
  const { data: links } = await sb
    .from('agency_companies')
    .select('company_id,created_at')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(200);

  const companyIds = ((links ?? []) as Array<{ company_id: string }>).map((l) => l.company_id);
  if (companyIds.length === 0) return [];

  const monthStart = currentMonthStartIso();
  const [{ data: companies }, { data: subs }, { data: credits }, { data: usage }, { data: convos }] =
    await Promise.all([
      sb.from('companies').select('id,name,status,created_at').in('id', companyIds),
      sb.from('subscriptions').select('company_id,plan,status').in('company_id', companyIds),
      sb.from('company_credit_accounts').select('company_id,balance_amount').in('company_id', companyIds),
      sb
        .from('ai_usage_logs')
        .select('company_id')
        .in('company_id', companyIds)
        .gte('created_at', monthStart)
        .limit(20000),
      sb.from('conversations').select('company_id').in('company_id', companyIds).limit(20000),
    ]);

  const tally = (rows: unknown[] | null): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of (rows ?? []) as Array<{ company_id: string }>) {
      map.set(row.company_id, (map.get(row.company_id) ?? 0) + 1);
    }
    return map;
  };
  const messages = tally(usage);
  const conversations = tally(convos);
  const subByCompany = new Map(
    ((subs ?? []) as Array<{ company_id: string; plan: string | null; status: string | null }>).map(
      (s) => [s.company_id, s],
    ),
  );
  const creditByCompany = new Map(
    ((credits ?? []) as Array<{ company_id: string; balance_amount: number }>).map((c) => [
      c.company_id,
      Number(c.balance_amount ?? 0),
    ]),
  );

  return ((companies ?? []) as Array<Record<string, unknown>>)
    .map((c) => {
      const id = c.id as string;
      const sub = subByCompany.get(id);
      return {
        companyId: id,
        name: c.name as string,
        status: (c.status as string) ?? 'active',
        plan: sub?.plan ?? null,
        subscriptionStatus: sub?.status ?? null,
        creditBalance: creditByCompany.get(id) ?? 0,
        messagesThisMonth: messages.get(id) ?? 0,
        conversations: conversations.get(id) ?? 0,
        createdAt: c.created_at as string,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
