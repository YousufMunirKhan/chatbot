-- ===========================================================================
-- Migration 0042 — Multilingual knowledge base
-- Tags documents/chunks with a language so retrieval can PREFER same-language
-- content for the visitor's detected language. Soft preference (boost), not a
-- hard filter — a single-language KB keeps working and cross-language fallback
-- still happens when no same-language match exists.
-- ===========================================================================

alter table public.documents add column if not exists language text;
alter table public.chunks    add column if not exists language text;

create index if not exists idx_chunks_company_language on public.chunks(company_id, language);

-- Recreate match_chunks to also return the chunk language (signature unchanged
-- so existing callers keep working). rag.ts applies the same-language boost.
drop function if exists public.match_chunks(uuid, uuid, text, text, int, text);

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
  keyword_rank double precision,
  language text
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
    ts_rank(b.tsv, (select tsq from q)) as keyword_rank,
    b.language
  from ids
  join base b on b.id = ids.id
  order by similarity desc;
$$;
