import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { classifyMembers } from '@/modules/super-admin/deletion-data';

/**
 * Ending somebody's session when their access ends (Module 3).
 *
 * Deleting a `company_users` row takes away what a person is allowed to do, but
 * it does nothing to the browser they are already signed in on. Until this
 * existed, a teammate removed for cause kept a working dashboard until their
 * refresh token aged out on its own — an hour of access, or a day, depending on
 * the project's token settings, at the exact moment access should have stopped.
 */

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * What happened, so the caller can tell an operator instead of guessing. A
 * revocation that was never needed and one that failed are very different
 * things to see on a Team page, so they are separate cases rather than a
 * boolean.
 */
export type RevocationOutcome =
  | { status: 'revoked'; sessionsRemoved: number | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Sign a user out everywhere by deleting their GoTrue session rows.
 *
 * The admin API on this client (auth-js 2.108) does expose `auth.admin.signOut`,
 * but it takes the *user's own* access token as its first argument, and an
 * administrator removing somebody else has never seen that token. There is no
 * admin-by-user-id logout endpoint, so the only lever available from this side
 * is the session state itself: `auth.sessions` holds one row per signed-in
 * device, and `auth.refresh_tokens` and `auth.mfa_amr_claims` are foreign-keyed
 * to it and go with it. The refresh tokens are deleted explicitly as well,
 * because projects created before GoTrue keyed refresh tokens to a session have
 * rows there that nothing would cascade to.
 *
 * The access token already sitting in that person's browser is not recalled —
 * a signed JWT cannot be — but every request in this app resolves its user
 * through `supabase.auth.getUser()`, which asks GoTrue, and GoTrue rejects a
 * token whose `session_id` claim no longer names a row. So access stops at
 * their next request rather than at token expiry.
 *
 * The `auth` schema is not reachable over PostgREST — Supabase exposes only
 * `public` and `graphql_public`, and exposing `auth` would put every session and
 * refresh token on the project behind the REST API. Migration 0071 therefore
 * adds `public.revoke_user_sessions`, a `security definer` function granted to
 * the service role alone, which is the one narrow verb this needs.
 */
export async function revokeUserSessions(
  sb: ServiceClient,
  userId: string,
): Promise<RevocationOutcome> {
  // Not `sb.schema('auth')`. Supabase exposes only `public` and
  // `graphql_public` over PostgREST, so reaching the auth tables directly
  // answers PGRST106 "Invalid schema: auth" every single time — the revocation
  // looked implemented and never once happened. Migration 0071 puts a
  // `security definer` function in `public` that can cross into `auth`, granted
  // to the service role alone.
  const { data, error } = await sb.rpc('revoke_user_sessions', { p_user_id: userId });

  if (error) {
    logger.error('Could not revoke the sessions of a user who lost access', {
      module: 'auth/revoke',
      userId,
      error: error.message,
    });
    return { status: 'failed', reason: error.message };
  }

  return { status: 'revoked', sessionsRemoved: typeof data === 'number' ? data : null };
}

/**
 * Revoke only if the person has nothing left to sign in for.
 *
 * Somebody dropped from one company may still work at another, and a platform
 * super admin must never be signed out by a tenant's admin at all — signing
 * either of them out would be a second bug wearing the first one's clothes.
 * `classifyMembers` already decides exactly this question for company deletion
 * (a `delete` fate means "this login exists only for that company"), so this
 * asks it rather than writing a second, drifting copy of the same rule.
 *
 * Call this AFTER the membership row is gone: `classifyMembers` counts the
 * memberships that remain, and the row being removed must not be one of them.
 * It is excluded by company either way, but the ordering is what makes the
 * answer right when the same person is removed from two companies at once.
 *
 * If the profile read inside `classifyMembers` fails, the answer comes back as
 * "nothing left" and the sessions go. That is the safe direction to be wrong
 * in: somebody who does still have access signs in again, whereas the other
 * way round leaves a dismissed teammate holding a live dashboard, which is the
 * bug this module exists to close.
 */
export async function revokeSessionsIfAccessEnded(
  sb: ServiceClient,
  userId: string,
  removedFromCompanyId: string,
  removedRole: string,
): Promise<RevocationOutcome> {
  const [fate] = await classifyMembers(sb, removedFromCompanyId, [
    { user_id: userId, role: removedRole },
  ]);

  if (!fate) {
    return { status: 'skipped', reason: 'Could not read the account, so it was left signed in' };
  }
  if (fate.fate === 'keep') {
    return { status: 'skipped', reason: fate.keptBecause };
  }

  return revokeUserSessions(sb, userId);
}
