-- ===========================================================================
-- Migration 0034 - Help Desk Audience Isolation
-- Keeps connector/internal helpdesk knowledge out of customer-facing bots while
-- letting internal assistants use both internal and public-safe knowledge.
-- ===========================================================================

alter table public.documents
  add column if not exists audience text not null default 'customer'
    check (audience in ('customer','internal','both'));

alter table public.chunks
  add column if not exists audience text not null default 'customer'
    check (audience in ('customer','internal','both'));

create index if not exists idx_documents_company_audience
  on public.documents(company_id, audience, created_at desc);

create index if not exists idx_chunks_company_audience
  on public.chunks(company_id, audience);

-- Existing docs already attached to internal assistants should stay internal.
update public.documents d
set audience = 'internal'
from public.bots b
where d.bot_id = b.id
  and (
    b.appearance_json->>'assistantAudience' = 'internal'
    or exists (select 1 from unnest(b.capability_flags) cap(value) where cap.value like 'internal_%')
  );

update public.chunks c
set audience = d.audience
from public.documents d
where c.document_id = d.id;

-- Connector-approved docs were previously ingested as company-wide knowledge.
-- Mark matching indexed documents/chunks as internal so customer bots cannot
-- retrieve software maps, staff workflows, reports, or connector action notes.
with connector_doc_titles as (
  select distinct
    company_id,
    module || ' - ' || screen as title
  from public.helpdesk_connector_documents
  where status = 'approved'
)
update public.documents d
set audience = 'internal'
from connector_doc_titles h
where d.company_id = h.company_id
  and d.title = h.title;

update public.chunks c
set audience = d.audience
from public.documents d
where c.document_id = d.id;

drop function if exists public.match_chunks(uuid, uuid, text, text, int);

create or replace function public.match_chunks(
  p_company_id uuid,
  p_bot_id uuid,
  p_query_embedding text,
  p_query_text text,
  p_match_count int default 6,
  p_audience text default 'customer'
)
returns table (
  id uuid,
  document_id uuid,
  text text,
  contextual_text text,
  similarity double precision,
  keyword_rank double precision
)
language sql stable
as $$
  with q as (
    select
      p_query_embedding::vector as emb,
      plainto_tsquery('simple', coalesce(p_query_text, '')) as tsq
  ),
  base as (
    select c.*
    from public.chunks c
    where c.company_id = p_company_id
      and (p_bot_id is null or c.bot_id = p_bot_id or c.bot_id is null)
      and (
        case
          when p_audience = 'internal' then c.audience in ('internal', 'customer', 'both')
          else c.audience in ('customer', 'both')
        end
      )
  ),
  vec as (
    select b.id, 1 - (b.embedding <=> (select emb from q)) as similarity
    from base b
    where b.embedding is not null
    order by b.embedding <=> (select emb from q) asc
    limit greatest(p_match_count, 1)
  ),
  kw as (
    select b.id, ts_rank(b.tsv, (select tsq from q)) as keyword_rank
    from base b
    where (select tsq from q) is not null
      and b.tsv @@ (select tsq from q)
    order by keyword_rank desc
    limit greatest(p_match_count, 1)
  ),
  ids as (
    select id from vec
    union
    select id from kw
  )
  select
    b.id,
    b.document_id,
    b.text,
    b.contextual_text,
    case when b.embedding is not null
      then 1 - (b.embedding <=> (select emb from q))
      else 0 end as similarity,
    ts_rank(b.tsv, (select tsq from q)) as keyword_rank
  from ids
  join base b on b.id = ids.id
  order by similarity desc;
$$;
