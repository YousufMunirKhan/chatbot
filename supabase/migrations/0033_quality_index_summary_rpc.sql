-- ===========================================================================
-- Migration 0033 - Quality Room index summary RPC
-- Collapses several dashboard count queries into one round trip.
-- ===========================================================================

create or replace function public.company_quality_index_summary(p_company_id uuid)
returns table (
  ready_documents integer,
  failed_documents integer,
  total_chunks integer,
  last_indexed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from public.documents where company_id = p_company_id and status = 'ready') as ready_documents,
    (select count(*)::integer from public.documents where company_id = p_company_id and status = 'failed') as failed_documents,
    (select count(*)::integer from public.chunks where company_id = p_company_id) as total_chunks,
    (
      select max(coalesce(updated_at, created_at))
      from public.documents
      where company_id = p_company_id and status = 'ready'
    ) as last_indexed_at;
$$;

grant execute on function public.company_quality_index_summary(uuid) to authenticated;
