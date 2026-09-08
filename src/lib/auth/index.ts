import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/db/server';
import { ForbiddenError } from '@/lib/errors';
import { ROLES, type Role } from '@/lib/constants';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';
import {
  policyFromMembershipRow,
  resolveTwoFactorGate,
  type CompanyTwoFactorPolicy,
} from './two-factor';

/**
 * Authentication & authorization helpers (Module 3).
 *
 * Built on Supabase Auth. The logged-in user's identity comes from the auth
 * session cookie; their role comes from `public.users.is_super_admin` (platform)
 * and `public.company_users.role` (per company). Convention finalized in this
 * module: `public.users.id == auth.users.id == auth.uid()`.
 */
export interface SessionUser {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  companyId: string | null;
  role: Role | null;
  impersonation: {
    sessionId: string;
    companyId: string;
    companyName: string | null;
    expiresAt: string;
  } | null;
}

interface SecurityRow {
  two_factor_enabled?: boolean | null;
  two_factor_method?: string | null;
  two_factor_verified_at?: string | null;
}

interface MembershipRow {
  company_id?: string | null;
  role?: string | null;
  created_at?: string | null;
}

interface ProfileBundle {
  isSuperAdmin: boolean;
  security: SecurityRow | null;
  membership: MembershipRow | null;
  /**
   * The company's two-factor policy, which rides along inside the embed below at
   * no extra round trip. `undefined` means it was not read — the degraded
   * three-query path — and the gate then fetches it itself. `null` means it WAS
   * read and there is no policy row, which is the normal case and must not
   * cost a second query. The distinction is load-bearing.
   */
  policy: CompanyTwoFactorPolicy | null | undefined;
}

const first = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/** Oldest membership wins — the same row `order(created_at).limit(1)` returned. */
function earliestMembership(rows: MembershipRow | MembershipRow[] | null | undefined): MembershipRow | null {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0] ?? null;
}

/**
 * The platform flag, the 2FA state and the company membership, in ONE request.
 *
 * These are three single-row reads keyed by the same user id, and they ran one
 * after another on every page load in the product — three sequential round
 * trips at ~230 ms each on this deployment, before any page had asked for its
 * own data. `user_security_settings.user_id` and `company_users.user_id` are
 * both foreign keys to `users.id`, so PostgREST can embed them and return the
 * lot in a single response.
 *
 * If the embed fails for any reason — a stale PostgREST schema cache is the
 * realistic one — the three original queries run instead. Authentication is the
 * one place in the app that must not have a single point of failure, so this
 * degrades to slow rather than to signed out.
 */
async function loadProfileBundle(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
): Promise<ProfileBundle> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'is_super_admin, user_security_settings(two_factor_enabled,two_factor_method,two_factor_verified_at), company_users(company_id,role,created_at,companies(company_two_factor_policies(required,grace_period_days,required_since)))',
    )
    .eq('id', userId)
    .maybeSingle();

  if (!error) {
    const row = (data ?? {}) as Record<string, unknown>;
    const membership = earliestMembership(
      row.company_users as MembershipRow | MembershipRow[] | null,
    );
    return {
      isSuperAdmin: Boolean(row.is_super_admin),
      security: first(row.user_security_settings as SecurityRow | SecurityRow[] | null),
      membership,
      policy: policyFromMembershipRow(membership),
    };
  }

  const [profileRes, securityRes, membershipRes] = await Promise.all([
    supabase.from('users').select('is_super_admin').eq('id', userId).maybeSingle(),
    supabase
      .from('user_security_settings')
      .select('two_factor_enabled,two_factor_method,two_factor_verified_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('company_users')
      .select('company_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    isSuperAdmin: Boolean((profileRes.data as { is_super_admin?: boolean } | null)?.is_super_admin),
    security: (securityRes.data as SecurityRow | null) ?? null,
    membership: (membershipRes.data as MembershipRow | null) ?? null,
    // Not read on this degraded path; the gate looks it up itself, cached.
    policy: undefined,
  };
}

/** Returns the current user (or null if not signed in). Read-only; never redirects. */
export const getSessionUser = cache(async function getSessionUser(
  options?: { skipTwoFactorCheck?: boolean },
): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { isSuperAdmin, security, membership, policy } = await loadProfileBundle(supabase, user.id);

  if (!options?.skipTwoFactorCheck) {
    const gate = await resolveTwoFactorGate({
      companyId: (membership?.company_id as string | undefined) ?? null,
      enabled: Boolean(security?.two_factor_enabled),
      method: security?.two_factor_method ?? null,
      verifiedAt: security?.two_factor_verified_at ?? null,
      policy,
    });
    // An emailed code and an authenticator app are different challenges on
    // different pages. Sending a TOTP user to /login/2fa shows them a box no
    // code they hold can satisfy.
    if (gate === 'challenge') {
      redirect(security?.two_factor_method === 'totp' ? '/two-factor' : '/login/2fa');
    }
    // Their company requires a second factor and the grace period to set one up
    // has run out. Nobody is signed out — the next page they open is the setup.
    if (gate === 'enrol') redirect('/two-factor/set-up');
  }

  let impersonation: SessionUser['impersonation'] = null;
  if (isSuperAdmin) {
    const sessionId = cookies().get(IMPERSONATION_COOKIE)?.value;
    if (sessionId) {
      const { data: session } = await createSupabaseServiceClient()
        .from('super_admin_impersonation_sessions')
        .select('id,company_id,expires_at,ended_at,companies(name)')
        .eq('id', sessionId)
        .eq('super_admin_id', user.id)
        .maybeSingle();
      const expiresAt = session?.expires_at ? new Date(session.expires_at).getTime() : 0;
      if (session && !session.ended_at && expiresAt > Date.now()) {
        const embeddedCompany = session.companies as { name?: string } | { name?: string }[] | null;
        const company = Array.isArray(embeddedCompany) ? embeddedCompany[0] : embeddedCompany;
        impersonation = {
          sessionId: session.id as string,
          companyId: session.company_id as string,
          companyName: company?.name ?? null,
          expiresAt: session.expires_at as string,
        };
      }
    }
  }

  const role: Role | null = isSuperAdmin
    ? impersonation
      ? ROLES.COMPANY_ADMIN
      : ROLES.SUPER_ADMIN
    : ((membership?.role as Role | undefined) ?? null);

  return {
    userId: user.id,
    email: user.email ?? '',
    isSuperAdmin,
    companyId: impersonation?.companyId ?? membership?.company_id ?? null,
    role,
    impersonation,
  };
});

/** The landing route for a user based on their role. */
export function homePathFor(user: SessionUser): string {
  if (user.impersonation) return '/company';
  if (user.isSuperAdmin) return '/super-admin';
  if (user.role === ROLES.AGENT) return '/company/inbox';
  if (user.companyId) return '/company';
  return '/dashboard';
}

/** Require a signed-in user, else redirect to /login. Use in server components. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

function hasRole(user: SessionUser, roles: Role[]): boolean {
  return roles.some((r) => (r === ROLES.SUPER_ADMIN ? user.isSuperAdmin : user.role === r));
}

/**
 * Require one of `roles`. If signed in but not permitted, redirect to the user's
 * own home (prevents cross-role access). Use in layouts/pages.
 */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, roles)) redirect(homePathFor(user));
  return user;
}

/** Throwing variant for route handlers / services. */
export function assertRole(user: SessionUser, roles: Role[]): void {
  if (!hasRole(user, roles)) throw new ForbiddenError();
}
