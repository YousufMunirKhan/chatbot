-- ===========================================================================
-- Migration 0071 — Make session revocation actually reachable
--
-- Removing a teammate now revokes their sessions, but the code that does it
-- called `sb.schema('auth').from('sessions').delete()`, and PostgREST answers:
--
--   PGRST106  Invalid schema: auth
--   "Only the following schemas are exposed: public, graphql_public"
--
-- Supabase does not expose `auth` over the REST API, and it should not — those
-- tables hold every session and refresh token on the project. So the revocation
-- silently failed every time: the membership was removed, the person kept
-- working access, and only a log line said so.
--
-- A `security definer` function in `public` is the way across. It runs as its
-- owner, so it can reach `auth`, while the API surface stays exactly one
-- narrowly-scoped verb instead of the whole schema.
--
-- Two things keep that verb from becoming a weapon. Execute is granted to
-- `service_role` alone — revoked from public, anon and authenticated — because
-- a signed-in user who could call this could sign out anybody on the platform
-- by guessing a uuid. And the body refuses a caller that is not the service
-- role, so a future grant added by accident cannot reopen it. That is the same
-- belt-and-braces shape migration 0063 used after a `security definer` function
-- with a uuid argument turned out to be a cross-tenant read primitive.
--
-- Refresh tokens go with the sessions. GoTrue checks the session row on every
-- request, so deleting sessions is what actually ends access; clearing the
-- refresh tokens as well stops a stored token minting a fresh one.
-- ===========================================================================

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = auth, public
as $$
declare
  removed integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'not permitted';
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.revoke_user_sessions(uuid) from public;
revoke execute on function public.revoke_user_sessions(uuid) from anon;
revoke execute on function public.revoke_user_sessions(uuid) from authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
