import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/db/server';
import { ForbiddenError } from '@/lib/errors';
import { ROLES, type Role } from '@/lib/constants';
import { IMPERSONATION_COOKIE } from '@/lib/impersonation';

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

/** Returns the current user (or null if not signed in). Read-only; never redirects. */
export async function getSessionUser(options?: { skipTwoFactorCheck?: boolean }): Promise<SessionUser | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  const isSuperAdmin = profile?.is_super_admin ?? false;
  const { data: security } = await supabase
    .from('user_security_settings')
    .select('two_factor_enabled,two_factor_verified_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!options?.skipTwoFactorCheck && security?.two_factor_enabled) {
    const verifiedAt = security.two_factor_verified_at ? new Date(security.two_factor_verified_at).getTime() : 0;
    const maxAgeMs = 12 * 60 * 60 * 1000;
    if (!verifiedAt || Date.now() - verifiedAt > maxAgeMs) redirect('/login/2fa');
  }

  const { data: membership } = await supabase
    .from('company_users')
    .select('company_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

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
}

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
