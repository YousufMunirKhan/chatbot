-- ===========================================================================
-- Migration 0075 — Knowledge ingestion: real limits, honest truncation,
--                  per-URL crawl pages, and queued (background) ingestion
--
-- WHAT WAS WRONG
-- --------------
-- The knowledge base could not hold a real small business. The ceilings were
-- 3 uploaded files, 5 MB per file, 10 PDF pages, 20,000 characters per document
-- and a crawler that took 8 pages one hop deep. A shop with a 40-page catalogue
-- and a 60-page policy PDF fitted into none of that.
--
-- Worse than the ceilings was the silence. `extractUploadedKnowledge` sliced the
-- extracted text at 20,000 characters and the URL importer sliced at 50,000,
-- both with a bare `.slice()`. Nothing was written down and nothing was shown,
-- so a shop uploaded a 60-page policy PDF, saw "File extracted and indexed.",
-- and got wrong answers for the 50 pages that were thrown away. The only limit
-- that spoke up at all was the PDF page count, and it spoke by refusing.
--
-- WHAT THIS ADDS
-- --------------
-- 1. Columns that record what actually happened to a document: how many pages
--    the source had, how many were read, whether text was dropped and why.
--    `src/lib/knowledge/limits.ts` holds the ceilings themselves; these columns
--    hold the outcome, so the UI can say "this PDF has 84 pages and we read the
--    first 60" instead of a green tick.
--
-- 2. `source_url` plus a PLAIN unique index on (company_id, source_url), so a
--    recrawl UPDATES the page it already has instead of adding a second copy of
--    it. Plain and not partial on purpose: PostgREST's `upsert`/`on_conflict`
--    cannot send an index predicate, so a partial index cannot serve it (the
--    same reason migration 0070 used a plain one). Null `source_url` values are
--    distinct from each other under a unique index, so the pasted-text and
--    uploaded-file documents that have no URL are unaffected.
--
-- 3. `ingest_progress` / `ingest_stage`, because ingestion moved onto the
--    `background_jobs` queue. Embedding a 60-page PDF is roughly 250 chunks and
--    minutes of provider round trips — it does not fit in a request, and the
--    spinner that claimed otherwise was lying. The document row now carries its
--    own progress so the page can show a real bar.
--
-- 4. `knowledge_crawls`, one row per website import. The crawler used to merge
--    every page into ONE document, which retrieves badly: every query matches
--    the same giant blob and the top chunk is whatever page happened to sit at
--    that offset. Pages are now one document each, and this table is what ties
--    them back to the import that created them so progress can be reported and
--    a recrawl can find its own pages.
-- ===========================================================================

-- --- documents: what actually happened during ingestion ---------------------

alter table public.documents
  add column if not exists source_url       text,
  add column if not exists crawl_id         uuid,
  add column if not exists source_bytes     bigint,
  add column if not exists page_count       integer,
  add column if not exists pages_ingested   integer,
  add column if not exists truncated        boolean not null default false,
  add column if not exists truncation_reason text,
  add column if not exists ingest_progress  smallint not null default 0,
  add column if not exists ingest_stage     text,
  add column if not exists last_ingested_at timestamptz;

comment on column public.documents.source_url is
  'Canonical URL this document was imported from. One document per URL: a '
  'recrawl updates the matching row instead of inserting a duplicate. Null for '
  'pasted text and uploaded files.';
comment on column public.documents.page_count is
  'Pages the SOURCE had (PDFs). Kept even when every page was read, so the UI '
  'can show "84 of 84 pages".';
comment on column public.documents.pages_ingested is
  'Pages actually read. Less than page_count means the ceiling in '
  'src/lib/knowledge/limits.ts was hit and truncation_reason says so.';
comment on column public.documents.truncated is
  'True when any source text was dropped. Set by the ingest path, never by the '
  'admin — it is how the UI knows to warn instead of showing a green tick.';
comment on column public.documents.ingest_progress is
  '0-100, written by the queued ingest job after each embedding batch. Real '
  'progress, not an animation.';
comment on column public.documents.ingest_stage is
  'What the ingest job is doing right now ("Indexing 192 of 480 sections"), or '
  'the failure message once status is ''failed''. Null when the document is '
  'ready and there is nothing to say.';
comment on column public.documents.crawl_id is
  'The website import that produced this page. A refresh creates a NEW crawl '
  'row and re-points its pages at it, which is how runCrawlJob knows which '
  'pages of the site it has already done in this run.';

-- Progress is a percentage; anything else means a caller has a bug.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_ingest_progress_range'
  ) then
    alter table public.documents
      add constraint documents_ingest_progress_range
      check (ingest_progress between 0 and 100);
  end if;
end$$;

-- The recrawl key. See the note above on why this is plain and not partial.
-- Existing rows all have a null source_url (the column is new), so there is
-- nothing to de-duplicate before creating it.
create unique index if not exists uq_documents_company_source_url
  on public.documents (company_id, source_url);

-- The queue drain looks for this company's documents that are still waiting.
create index if not exists idx_documents_company_status
  on public.documents (company_id, status, created_at desc);

create index if not exists idx_documents_crawl
  on public.documents (crawl_id);

-- --- knowledge_crawls: one row per website import ---------------------------

create table if not exists public.knowledge_crawls (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  bot_id           uuid references public.bots(id) on delete cascade,
  root_url         text not null,
  -- 'sitemap' when the site published one, 'links' when we had to follow hrefs.
  discovery        text not null default 'links'
                     check (discovery in ('sitemap', 'links')),
  status           text not null default 'queued'
                     check (status in ('queued','running','completed','partial','failed')),
  pages_discovered integer not null default 0,
  pages_ingested   integer not null default 0,
  pages_failed     integer not null default 0,
  page_limit       integer not null default 0,
  -- True when the site had more pages than page_limit. The admin is told the
  -- number we skipped rather than being left to assume we read everything.
  pages_skipped    integer not null default 0,
  error_message    text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_knowledge_crawls_company
  on public.knowledge_crawls (company_id, created_at desc);

drop trigger if exists trg_knowledge_crawls_updated_at on public.knowledge_crawls;
create trigger trg_knowledge_crawls_updated_at before update on public.knowledge_crawls
  for each row execute function public.set_updated_at();

-- Foreign key added after the table exists, so the column above can be created
-- on an existing `documents` table in either order.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_crawl_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_crawl_id_fkey
      foreign key (crawl_id) references public.knowledge_crawls(id) on delete set null;
  end if;
end$$;

-- RLS mirrors documents (migration 0006): members read their own company's
-- crawls, super admins read everything. Writes go through the service-role
-- client, whose company_id filter in code is the real tenant boundary.
alter table public.knowledge_crawls enable row level security;

drop policy if exists knowledge_crawls_super_admin_all on public.knowledge_crawls;
create policy knowledge_crawls_super_admin_all on public.knowledge_crawls
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists knowledge_crawls_select_members on public.knowledge_crawls;
create policy knowledge_crawls_select_members on public.knowledge_crawls
  for select to authenticated
  using (company_id in (select public.user_company_ids()));
