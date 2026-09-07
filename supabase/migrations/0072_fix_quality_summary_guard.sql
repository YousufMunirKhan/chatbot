-- ===========================================================================
-- Migration 0072 — Repair the guard 0063 put on the quality summary
--
-- 0063 closed a real cross-tenant hole: `company_quality_index_summary` is
-- `security definer`, takes the company id as an argument, and had execute
-- granted to `authenticated`, so any signed-in user could ask it about anybody.
-- Revoking that grant was right. The belt-and-braces check added inside the
-- body was not:
--
--   if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
--
-- That reads a claim out of a JWT. Supabase's newer API keys — the
-- `sb_secret_…` / `sb_publishable_…` format this project now uses — are opaque
-- keys, not JWTs, so the setting comes back null, the comparison is true for
-- everyone, and the function refuses the server's own service-role call. The
-- page went to production raising "not permitted for this company" against a
-- legitimate caller, which is how it was found.
--
-- The fix is to stop asking HOW the caller authenticated and ask WHO they are.
-- `auth.uid()` is null when there is no end-user JWT, which is exactly the
-- server-side service-role case, and it carries the user's id when a person is
-- calling. That distinction is stable across both key formats.
--
-- The security property is unchanged and still rests where it should: execute
-- is granted to `service_role` alone, so anon and authenticated cannot reach
-- the function at all. The body check only has to stop a future accidental
-- re-grant from handing one tenant another tenant's numbers, and requiring
-- membership when a user is present does precisely that.
-- ===========================================================================

create or replace function public.company_quality_index_summary(p_company_id uuid)
returns table (
  ready_documents integer,
  failed_documents integer,
  total_chunks integer,
  last_indexed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  -- A null caller means no end-user token: the server itself, which has already
  -- established which company the request belongs to. Anyone else must be a
  -- member of the company they are asking about.
  if caller is not null
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = p_company_id
         and cu.user_id = caller
     )
     and not public.is_super_admin()
  then
    raise exception 'not permitted for this company';
  end if;

  return query
  select
    (select count(*)::integer from public.documents d
      where d.company_id = p_company_id and d.status = 'ready'),
    (select count(*)::integer from public.documents d
      where d.company_id = p_company_id and d.status = 'failed'),
    (select count(*)::integer from public.chunks c
      where c.company_id = p_company_id),
    (select max(coalesce(d.updated_at, d.created_at)) from public.documents d
      where d.company_id = p_company_id and d.status = 'ready');
end;
$$;

revoke execute on function public.company_quality_index_summary(uuid) from public;
revoke execute on function public.company_quality_index_summary(uuid) from anon;
revoke execute on function public.company_quality_index_summary(uuid) from authenticated;
grant execute on function public.company_quality_index_summary(uuid) to service_role;
