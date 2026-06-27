-- ===========================================================================
-- Migration 0006 — Knowledge base / RAG (Module 10)
-- documents + document_sources + chunks (vector + tsvector) + ingestion_jobs.
-- Embedding dimension = 1536 (text-embedding-3-small / mock provider).
-- ===========================================================================

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  bot_id      uuid references public.bots(id) on delete cascade,
  title       text not null default 'Untitled',
  source_type text not null default 'text'
                check (source_type in ('text','url','pdf','docx','txt','faq','csv')),
  status      text not null default 'pending'
                check (status in ('pending','processing','ready','failed')),
  char_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_documents_company on public.documents(company_id);
create index if not exists idx_documents_bot on public.documents(bot_id);

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create table if not exists public.document_sources (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  url         text,
  file_path   text,
  raw_text    text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_document_sources_document on public.document_sources(document_id);

create table if not exists public.chunks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  bot_id           uuid references public.bots(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete cascade,
  text             text not null,
  contextual_text  text,
  embedding        vector(1536),
  tsv              tsvector generated always as (to_tsvector('simple', coalesce(contextual_text, text))) stored,
  metadata_json    jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_chunks_company on public.chunks(company_id);
create index if not exists idx_chunks_bot on public.chunks(bot_id);
create index if not exists idx_chunks_tsv on public.chunks using gin(tsv);
create index if not exists idx_chunks_embedding on public.chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists public.ingestion_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  document_id    uuid references public.documents(id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending','processing','completed','failed')),
  chunks_created integer not null default 0,
  error_message  text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_ingestion_jobs_company on public.ingestion_jobs(company_id);

-- RLS: members read their company's knowledge; super admins read all.
do $$
declare t text;
begin
  foreach t in array array['documents','document_sources','chunks','ingestion_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
  end loop;
end$$;

-- Member SELECT (document_sources is reached via its document's company).
drop policy if exists documents_select_members on public.documents;
create policy documents_select_members on public.documents
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists chunks_select_members on public.chunks;
create policy chunks_select_members on public.chunks
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists ingestion_jobs_select_members on public.ingestion_jobs;
create policy ingestion_jobs_select_members on public.ingestion_jobs
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists document_sources_select_members on public.document_sources;
create policy document_sources_select_members on public.document_sources
  for select to authenticated
  using (document_id in (select id from public.documents where company_id in (select public.user_company_ids())));

-- Hybrid retrieval RPC: vector similarity ordering + keyword rank.
-- Embedding passed as a JSON-ish text array and cast to vector to avoid
-- PostgREST vector-binding issues.
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
  select
    c.id,
    c.document_id,
    c.text,
    c.contextual_text,
    1 - (c.embedding <=> p_query_embedding::vector) as similarity,
    ts_rank(c.tsv, plainto_tsquery('simple', coalesce(p_query_text, ''))) as keyword_rank
  from public.chunks c
  where c.company_id = p_company_id
    and (p_bot_id is null or c.bot_id = p_bot_id or c.bot_id is null)
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding::vector asc
  limit greatest(p_match_count, 1);
$$;
