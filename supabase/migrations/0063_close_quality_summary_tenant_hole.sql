-- ===========================================================================
-- Migration 0063 — Close a cross-tenant read on the quality summary RPC
--
-- `company_quality_index_summary(p_company_id uuid)` from migration 0033 is
-- `security definer`, so it runs as its owner and row-level security does not
-- apply to what it reads. It takes the company id as an ARGUMENT, and execute
-- was granted to `authenticated`.
--
-- Those three facts together make it a cross-tenant read primitive: any signed
-- in user could POST to /rest/v1/rpc/company_quality_index_summary with another
-- company's uuid and receive that company's document and chunk counts. Nothing
-- in the function checked that the caller had any relationship to the company
-- it was being asked about.
--
-- The application only ever calls it through the service role, so removing the
-- grant costs nothing. Belt and braces: the body now also refuses a caller that
-- is neither the service role nor a member of the company, so re-granting it by
-- accident cannot reopen the hole.
-- ===========================================================================

revoke execute on function public.company_quality_index_summary(uuid) from public;
revoke execute on function public.company_quality_index_summary(uuid) from anon;
revoke execute on function public.company_quality_index_summary(uuid) from authenticated;

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
begin
  -- `service_role` is the server itself, which has already established which
  -- company the request belongs to. Any other caller must be a member of the
  -- company it is asking about.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = p_company_id
         and cu.user_id = auth.uid()
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

grant execute on function public.company_quality_index_summary(uuid) to service_role;
