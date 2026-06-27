-- ===========================================================================
-- Migration 0020 — Bot optimization
--   * True hybrid retrieval: union of vector-top-N and keyword-top-N, so a
--     strong keyword match outside the vector neighbourhood still surfaces
--     (Issue #4). Returns a larger candidate pool for reranking (Issue #5/#6).
--   * Multi-instance rate limiting backed by Postgres (Issue #16).
--   * Conversation rolling-summary columns for long-chat memory (Issue #9).
-- ===========================================================================

-- --- Hybrid retrieval --------------------------------------------------------
create or replace function public.match_chunks(
  p_company_id uuid,
  p_bot_id uuid,
  p_query_embedding text,
  p_query_text text,
  p_match_count int default 6
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

-- --- Rate limiting (multi-instance) -----------------------------------------
create table if not exists public.rate_limits (
  key       text primary key,
  count     integer not null default 0,
  reset_at  timestamptz not null
);
-- Infra table — service-role only. RLS on with no policy denies anon/authenticated
-- (the service client used by the limiter bypasses RLS).
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(
  p_key text,
  p_limit int,
  p_window_ms int
)
returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_count int;
begin
  insert into public.rate_limits (key, count, reset_at)
  values (p_key, 1, v_now + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update set
    count = case when public.rate_limits.reset_at < v_now then 1 else public.rate_limits.count + 1 end,
    reset_at = case when public.rate_limits.reset_at < v_now
                 then v_now + make_interval(secs => p_window_ms / 1000.0)
                 else public.rate_limits.reset_at end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- --- Conversation rolling summary (long-chat memory) -------------------------
alter table public.conversations add column if not exists summary text;
alter table public.conversations
  add column if not exists summary_message_count integer not null default 0;
