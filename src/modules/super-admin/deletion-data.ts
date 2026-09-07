import { unstable_noStore as noStore } from 'next/cache';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

/**
 * What deleting a company would actually destroy.
 *
 * Every `company_id` foreign key in this schema is `on delete cascade` (108 of
 * them), so removing the `companies` row removes the tenant's data in one
 * statement. That is convenient and completely silent, which is why this exists:
 * an operator should see the size of what they are about to erase before they
 * erase it, not discover it afterwards.
 *
 * Login accounts are the exception. `public.users` has no foreign key to
 * `companies` — it is joined through `company_users`, and only that join row
 * cascades. So a plain company delete leaves the people behind, able to sign in
 * to nothing. This module works out which of them exist solely because of this
 * company and can therefore go with it.
 */

export type UserFate = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  /** `delete` means this login exists only for this company. */
  fate: 'delete' | 'keep';
  /** Why it is being kept. Empty when the fate is `delete`. */
  keptBecause: string;
};

export type CompanyDeletionPreview = {
  id: string;
  name: string;
  createdAt: string | null;
  /** Row counts for the tables worth naming out loud. */
  counts: { label: string; value: number }[];
  users: UserFate[];
  usersDeleted: number;
  usersKept: number;
};

/**
 * Tables named in the confirmation dialog. Deliberately a short list of things
 * an operator recognises — not all 108 cascading tables, which would be a wall
 * of noise. Everything else goes too; the dialog says so in words.
 */
const COUNTED: { table: string; label: string }[] = [
  { table: 'conversations', label: 'Conversations' },
  { table: 'messages', label: 'Messages' },
  { table: 'leads', label: 'Leads' },
  { table: 'documents', label: 'Knowledge documents' },
  { table: 'bots', label: 'Bots' },
  { table: 'appointments', label: 'Appointments' },
];

export async function getCompanyDeletionPreview(
  companyId: string,
): Promise<CompanyDeletionPreview | null> {
  noStore();
  const sb = createSupabaseServiceClient();

  const { data: company, error } = await sb
    .from('companies')
    .select('id,name,created_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error || !company) return null;
  const co = company as { id: string; name: string; created_at: string | null };

  // `head: true` asks PostgREST for the count without transferring any rows.
  // A table that fails to count must not take the whole dialog down with it —
  // the operator still needs to see the rest and the user list.
  const countOne = async (table: string): Promise<number | null> => {
    const { count, error: countError } = await sb
      .from(table)
      .select('id', { head: true, count: 'exact' })
      .eq('company_id', companyId);
    if (countError) {
      logger.warn('Could not count a table for the deletion preview', {
        table,
        companyId,
        error: countError.message,
      });
      return null;
    }
    return count ?? 0;
  };

  const [counts, members] = await Promise.all([
    Promise.all(COUNTED.map(async (c) => ({ label: c.label, value: await countOne(c.table) }))),
    sb.from('company_users').select('user_id,role').eq('company_id', companyId),
  ]);

  const memberRows = (members.data ?? []) as { user_id: string; role: string }[];
  const users = await classifyMembers(sb, companyId, memberRows);

  return {
    id: co.id,
    name: co.name,
    createdAt: co.created_at,
    counts: counts
      .filter((c): c is { label: string; value: number } => c.value !== null)
      .filter((c) => c.value > 0),
    users,
    usersDeleted: users.filter((u) => u.fate === 'delete').length,
    usersKept: users.filter((u) => u.fate === 'keep').length,
  };
}

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Decide, for each member, whether their login goes with the company.
 *
 * A login is kept when removing it would take away access the person still has
 * somewhere else, or when it is a platform account. Everything else exists only
 * to reach this company and has nothing left to sign in to.
 */
export async function classifyMembers(
  sb: ServiceClient,
  companyId: string,
  memberRows: { user_id: string; role: string }[],
): Promise<UserFate[]> {
  const ids = Array.from(new Set(memberRows.map((m) => m.user_id)));
  if (!ids.length) return [];

  const [profilesRes, elsewhereRes] = await Promise.all([
    sb.from('users').select('id,email,full_name,is_super_admin').in('id', ids),
    sb.from('company_users').select('user_id,company_id').in('user_id', ids).neq('company_id', companyId),
  ]);

  const profiles = new Map(
    ((profilesRes.data ?? []) as {
      id: string;
      email: string;
      full_name: string | null;
      is_super_admin: boolean | null;
    }[]).map((p) => [p.id, p]),
  );
  const otherCompanies = new Map<string, number>();
  for (const row of (elsewhereRes.data ?? []) as { user_id: string }[]) {
    otherCompanies.set(row.user_id, (otherCompanies.get(row.user_id) ?? 0) + 1);
  }

  const roleOf = new Map(memberRows.map((m) => [m.user_id, m.role]));

  return ids
    .map((id) => {
      const profile = profiles.get(id);
      const others = otherCompanies.get(id) ?? 0;
      const base = {
        id,
        email: profile?.email ?? '(unknown)',
        fullName: profile?.full_name ?? null,
        role: roleOf.get(id) ?? 'member',
      };
      if (profile?.is_super_admin) {
        return { ...base, fate: 'keep' as const, keptBecause: 'Platform super admin' };
      }
      if (others > 0) {
        return {
          ...base,
          fate: 'keep' as const,
          keptBecause: others === 1 ? 'Also in 1 other company' : `Also in ${others} other companies`,
        };
      }
      return { ...base, fate: 'delete' as const, keptBecause: '' };
    })
    .sort((a, b) => (a.fate === b.fate ? a.email.localeCompare(b.email) : a.fate === 'delete' ? -1 : 1));
}
