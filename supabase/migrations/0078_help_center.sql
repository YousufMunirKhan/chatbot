-- ===========================================================================
-- Migration 0078 — Help centre: written articles, categories, search, SEO
--
-- WHAT WAS THERE
-- --------------
-- `/help/<publicBotId>` existed and listed, at most, the 200 most recent
-- knowledge `documents` whose audience was customer-facing. That is a dump of
-- the RAG index, not a help centre: the rows are whatever was last uploaded or
-- crawled, in upload order, with no categories, no ordering, no draft state and
-- a search box that filtered an array in the browser. Nothing in the dashboard
-- linked to it, so most companies never knew it was there.
--
-- WHAT THIS ADDS
-- --------------
-- `help_articles` — a page somebody WROTE, with a slug, a category, a position
-- inside that category, a draft/published state and its own SEO fields. This is
-- deliberately NOT another `status` value on `documents`: a document is a
-- source we ingested (a PDF, a crawled page) and its status column describes an
-- ingestion pipeline ('pending' → 'processing' → 'ready' → 'failed'). Draft is
-- not a stage of ingestion, and bolting it onto that check constraint would put
-- unfinished writing in front of the retriever and every reader of that column.
--
-- `help_categories` — the browse structure. A reader with 40 articles needs
-- headings, not a longer scroll.
--
-- `help_center_settings` — one row per company holding the public handle, the
-- title and the meta description. The handle matters for more than tidiness: a
-- company with three bots had three URLs serving identical content, which is
-- the textbook duplicate-content penalty. With a handle there is ONE canonical
-- address and the bot-id URLs still resolve, so no link anybody already
-- published breaks.
--
-- SEARCH
-- ------
-- Postgres full-text, the same mechanism `chunks.tsv` has used since 0006:
-- a stored generated `tsvector` column with a GIN index over it, built with the
-- 'simple' configuration. 'simple' and not 'english' on purpose — this schema
-- is multilingual (0042 gave documents and chunks a `language` column and the
-- retriever prefers the visitor's own), and stemming Arabic content with an
-- English dictionary makes it less findable, not more.
--
-- `search_help_centre` searches BOTH surfaces in one ranked list: the written
-- articles by their own tsvector, and the older knowledge documents through
-- `chunks.tsv`, which is already built and already indexed. Rolling the
-- documents up through their chunks rather than re-running `to_tsvector` over
-- `document_sources.raw_text` at query time is what keeps this cheap — a
-- 60-page PDF is one seq-scanned megabyte per query the other way round.
--
-- THE GUARD ON THE FUNCTION
-- -------------------------
-- `security definer`, guarded by `auth.uid()` and not by a JWT claim. This
-- project uses Supabase's newer `sb_secret_…` keys, which are opaque and carry
-- no claims at all, so `current_setting('request.jwt.claim.role', true)` is
-- always null and a guard written that way refuses the server's own call —
-- exactly the bug 0072 had to go back and repair. A null `auth.uid()` means no
-- end-user token, which is the server; a non-null one must be a member of the
-- company being asked about. The real protection is still the grant: execute is
-- revoked from public/anon/authenticated and given to `service_role` alone.
--
-- The anonymous reader never authenticates at all. Their page is rendered on
-- the server with the service client, and the `company_id` + published filters
-- in that call ARE the tenant boundary, as everywhere else in this codebase.
-- ===========================================================================

-- --- Categories -------------------------------------------------------------

create table if not exists public.help_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  slug        text not null,
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Plain unique index, not partial. PostgREST's upsert/on_conflict cannot send
-- an index predicate, so a partial one could never serve it (0070, 0075).
create unique index if not exists uq_help_categories_company_slug
  on public.help_categories(company_id, slug);
create index if not exists idx_help_categories_company_position
  on public.help_categories(company_id, position, name);

drop trigger if exists trg_help_categories_updated_at on public.help_categories;
create trigger trg_help_categories_updated_at before update on public.help_categories
  for each row execute function public.set_updated_at();

-- --- Articles ---------------------------------------------------------------

create table if not exists public.help_articles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- Losing a category must never lose the writing. The article falls back into
  -- the uncategorised bucket, which the public page renders last.
  category_id uuid references public.help_categories(id) on delete set null,
  title       text not null default 'Untitled',
  slug        text not null,
  -- The one-line summary under the title in the list, and the fallback meta
  -- description. Written by hand when it matters, derived from the body when it
  -- does not.
  excerpt     text,
  body        text not null default '',
  status      text not null default 'draft'
                check (status in ('draft','published')),
  -- SEO overrides. Null means "use the title / the excerpt", which is the right
  -- answer almost always; these exist for the article whose page title should
  -- read differently from its heading.
  seo_title       text,
  seo_description text,
  position    integer not null default 0,
  published_at timestamptz,
  author_id   uuid references public.users(id) on delete set null,
  -- The knowledge document this article is indexed as, so the assistant can
  -- answer from it. Null until it is published, and null again after it is
  -- withdrawn. Nullable and `on delete set null` because an admin deleting the
  -- document from the knowledge page must not delete the article they wrote.
  knowledge_document_id uuid references public.documents(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Title weighted above summary above body: a search for "refund" should put
  -- the article CALLED "Refunds" above one that mentions the word in passing.
  search_tsv  tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) stored
);

create unique index if not exists uq_help_articles_company_slug
  on public.help_articles(company_id, slug);
create index if not exists idx_help_articles_company_status
  on public.help_articles(company_id, status, position);
create index if not exists idx_help_articles_category
  on public.help_articles(category_id, position);
create index if not exists idx_help_articles_search
  on public.help_articles using gin(search_tsv);

drop trigger if exists trg_help_articles_updated_at on public.help_articles;
create trigger trg_help_articles_updated_at before update on public.help_articles
  for each row execute function public.set_updated_at();

-- --- Per-company public surface --------------------------------------------

create table if not exists public.help_center_settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  -- The canonical public handle: /help/<slug>. Null until an owner picks one,
  -- and the bot-id URL keeps working either way.
  slug        text,
  title       text not null default 'Help Center',
  description text,
  -- An owner who has not written anything yet can keep the public pages dark
  -- without deleting drafts.
  is_published boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Global, because the handle is the whole path segment. Nulls are distinct
-- under a unique index, so companies that never pick one do not collide.
create unique index if not exists uq_help_center_settings_slug
  on public.help_center_settings(slug);

drop trigger if exists trg_help_center_settings_updated_at on public.help_center_settings;
create trigger trg_help_center_settings_updated_at before update on public.help_center_settings
  for each row execute function public.set_updated_at();

-- --- RLS --------------------------------------------------------------------
-- Every read and write in the app goes through the service-role client, which
-- bypasses RLS entirely; these policies are the second lock, matching 0006.

do $$
declare t text;
begin
  foreach t in array array['help_categories','help_articles','help_center_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all', t);
  end loop;
end$$;

drop policy if exists help_categories_select_members on public.help_categories;
create policy help_categories_select_members on public.help_categories
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists help_articles_select_members on public.help_articles;
create policy help_articles_select_members on public.help_articles
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists help_center_settings_select_members on public.help_center_settings;
create policy help_center_settings_select_members on public.help_center_settings
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --- Search -----------------------------------------------------------------

drop function if exists public.search_help_centre(uuid, text, boolean, integer);

create or replace function public.search_help_centre(
  p_company_id uuid,
  p_query text,
  -- The public site passes true and can therefore never see a draft. The
  -- dashboard passes false so a writer can find the thing they have not
  -- finished. The default is the safe one on purpose: a caller that forgets
  -- the argument gets the public answer.
  p_published_only boolean default true,
  p_limit integer default 20
)
returns table (
  kind text,
  id uuid,
  slug text,
  title text,
  snippet text,
  category_id uuid,
  rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
-- ^ The OUT parameters above are called `id`, `title`, `rank` and so on, which
-- are also column names in the query below. Without that line plpgsql resolves
-- an unqualified `title` to the parameter; with it, a name that matches a
-- column is the column, which is what every reference here means. It has to be
-- the FIRST thing in the body — plpgsql reads its compiler options before the
-- declare block.
declare
  caller uuid := auth.uid();
  q tsquery;
begin
  -- Null caller = no end-user token = the server, which has already decided
  -- which company this request belongs to. See the header note on 0072: asking
  -- WHO rather than HOW is the only form of this check that survives opaque
  -- API keys.
  if caller is not null
     and not exists (
       select 1 from public.company_users cu
       where cu.company_id = p_company_id and cu.user_id = caller
     )
     and not public.is_super_admin()
  then
    raise exception 'not permitted for this company';
  end if;

  -- websearch_to_tsquery is the forgiving parser: it accepts quotes, OR and a
  -- leading minus from a person typing into a box, and it never raises on
  -- punctuation the way to_tsquery does.
  q := websearch_to_tsquery('simple', coalesce(p_query, ''));
  if q is null or numnode(q) = 0 then
    return;
  end if;

  return query
  with articles as (
    select
      'article'::text as kind,
      a.id,
      a.slug,
      a.title,
      coalesce(nullif(a.excerpt, ''), left(a.body, 240)) as snippet,
      a.category_id,
      ts_rank(a.search_tsv, q) as rank
    from public.help_articles a
    where a.company_id = p_company_id
      and a.search_tsv @@ q
      and (not p_published_only or a.status = 'published')
  ),
  -- The knowledge base a company already had. Matched through `chunks.tsv`,
  -- which is built and GIN-indexed already, and rolled up to one row per
  -- document by keeping the best-ranked chunk as the snippet.
  docs as (
    select distinct on (d.id)
      'document'::text as kind,
      d.id,
      null::text as slug,
      d.title,
      left(c.text, 240) as snippet,
      null::uuid as category_id,
      ts_rank(c.tsv, q) as rank
    from public.chunks c
    join public.documents d on d.id = c.document_id
    where c.company_id = p_company_id
      and c.tsv @@ q
      and d.company_id = p_company_id
      and d.status = 'ready'
      and d.audience in ('customer', 'both')
      -- Articles are indexed as documents too, so that the assistant can quote
      -- them. Without this they would come back twice under two names.
      and coalesce(d.source_url, '') not like 'help-article:%'
    order by d.id, ts_rank(c.tsv, q) desc
  )
  select * from (
    select * from articles
    union all
    select * from docs
  ) hits
  -- A written article outranks a crawled page at equal relevance: somebody
  -- chose to explain that, which is a stronger signal than a keyword landing in
  -- a PDF.
  order by hits.rank desc, (hits.kind = 'article') desc, hits.title asc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

revoke execute on function public.search_help_centre(uuid, text, boolean, integer) from public;
revoke execute on function public.search_help_centre(uuid, text, boolean, integer) from anon;
revoke execute on function public.search_help_centre(uuid, text, boolean, integer) from authenticated;
grant execute on function public.search_help_centre(uuid, text, boolean, integer) to service_role;
