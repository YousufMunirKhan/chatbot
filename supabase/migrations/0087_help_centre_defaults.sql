-- ===========================================================================
-- Migration 0087 — Help centre: the address every company already had
--
-- THE BUG
-- -------
-- 0078 gave `help_center_settings.slug` no default and left choosing a handle
-- to the owner. Nobody chose one. `/help/<handle>` resolves a handle to a
-- company by looking that column up, so with every row's slug null — and most
-- companies having no row at all, because 0078 only created one when somebody
-- opened the settings form and saved it — every address 404s. A help centre
-- with nothing in it is a legitimate state and should say so; a help centre
-- nobody can reach is a feature that looks broken.
--
-- WHAT THIS DOES
-- --------------
-- Derives a handle for every company from the slug it already has, writes the
-- settings row for the companies that never had one, and hangs a trigger on
-- `companies` so the next one created gets the same treatment without anybody
-- having to remember. After this, `/help/<handle>` resolves for every company
-- on the platform.
--
-- WHY THE COMPANY SLUG
-- --------------------
-- `companies.slug` exists on every row (0015 backfilled it and every code path
-- that creates a company since sets it), it is unique, and it is derived from
-- the name the customer typed — so the handle they get for free reads like the
-- one they would have picked, and it is the same word this codebase already
-- puts in `/c/<slug>`. Uniqueness is still CHECKED rather than assumed:
-- `uq_help_center_settings_slug` is global, because the handle is the whole
-- path segment, and a company may already have chosen another company's slug
-- as its own handle.
--
-- SHAPES A HANDLE MAY NOT TAKE
-- ----------------------------
-- `/help/<handle>` also accepts a bot's `public_bot_id`, which 0002 defines as
-- a uuid with the hyphens stripped — 32 hex characters. A handle of that shape
-- could shadow another company's help centre, so it is refused here exactly as
-- `isReservedHandle` in `src/modules/help-center/slug.ts` refuses it on the way
-- in, along with the path segments the routes own (`category`, `sitemap.xml`
-- and the rest). The two lists have to agree; changing one means changing both.
--
-- IS THIS PUBLISHING ANYTHING THAT WAS PRIVATE?
-- ---------------------------------------------
-- No. These rows are created with `is_published` at its default of true, and
-- that is the state those companies are ALREADY in: with no settings row, the
-- bot-id address `/help/<public_bot_id>` serves the same help centre today
-- (`resolveHelpCenter` treats a missing row as visible, and did before 0078 as
-- well). The pages show published articles and customer-facing knowledge
-- documents and nothing else, so a company with neither gets an empty page at a
-- tidier address, not an exposure. An owner who wants it dark still has the
-- switch, and switching it off now covers both addresses.
-- ===========================================================================

-- --- The shape of a derived handle ------------------------------------------

-- Split out from the lookup below so the trigger's collision retry can reuse
-- the same normalisation instead of writing a second, subtly different one.
create or replace function public.help_center_handle_base(
  p_slug text,
  p_name text,
  p_company_id uuid
)
returns text
language sql
immutable
as $$
  select case
    -- A name with no ASCII letters in it at all — this product is Arabic and
    -- English — slugifies to nothing, and the id is the only thing every
    -- company is guaranteed to have. Eight hex characters is short enough to
    -- read out over the phone and long enough not to collide.
    when candidate = '' then 'help-' || left(replace(p_company_id::text, '-', ''), 8)
    -- Reserved by the routes, or shaped like a bot's public id.
    when candidate in ('category', 'search', 'sitemap.xml', 'robots.txt', 'api', 'new')
      or candidate ~ '^[0-9a-f]{32}$'
      then rtrim(left(candidate, 74), '-') || '-help'
    else candidate
  end
  from (
    select rtrim(ltrim(left(
      regexp_replace(
        lower(coalesce(nullif(trim(p_slug), ''), p_name, '')),
        '[^a-z0-9]+', '-', 'g'
      ),
      80), '-'), '-') as candidate
  ) normalised;
$$;

-- The first handle nobody else is using. Reads `help_center_settings`, so it is
-- deliberately not `stable`: the backfill below calls it once per company in a
-- loop and each call has to see the handle the previous iteration just took.
create or replace function public.help_center_default_handle(p_company_id uuid)
returns text
language plpgsql
as $$
declare
  v_base text;
  v_candidate text;
begin
  select public.help_center_handle_base(c.slug, c.name, c.id)
    into v_base
    from public.companies c
   where c.id = p_company_id;

  -- No such company: the caller has nothing to name, and null is a clearer
  -- answer than a handle for a row that does not exist.
  if v_base is null then
    return null;
  end if;

  for n in 1..50 loop
    v_candidate := case
      when n = 1 then v_base
      else rtrim(left(v_base, 75), '-') || '-' || n::text
    end;

    if not exists (
      select 1
        from public.help_center_settings s
       where s.slug = v_candidate
         and s.company_id is distinct from p_company_id
    ) then
      return v_candidate;
    end if;
  end loop;

  -- Fifty businesses sharing one name is not something that happens, but an
  -- ugly handle beats an error: six characters off the id are unique enough
  -- that the index will not see them twice.
  return rtrim(left(v_base, 70), '-') || '-' || left(md5(p_company_id::text), 6);
end;
$$;

-- Neither of these is meant to be reachable over PostgREST — they are called by
-- the trigger below, which is `security definer` and therefore runs them as the
-- owner. Nothing in the app calls them by name, so nothing needs the grant.
revoke execute on function public.help_center_handle_base(text, text, uuid) from public;
revoke execute on function public.help_center_handle_base(text, text, uuid) from anon;
revoke execute on function public.help_center_handle_base(text, text, uuid) from authenticated;
revoke execute on function public.help_center_default_handle(uuid) from public;
revoke execute on function public.help_center_default_handle(uuid) from anon;
revoke execute on function public.help_center_default_handle(uuid) from authenticated;

-- --- Every new company gets one ---------------------------------------------

-- `security definer` and guarded by nothing else on purpose: this is a trigger,
-- not an RPC. It can only run as part of an insert into `companies`, which is
-- itself already behind the service client, and it needs the owner's rights to
-- write a row in a table whose RLS policies only admit super admins.
create or replace function public.help_center_seed_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  -- "Acme Help Center" rather than a bare "Help Center", which is what the
  -- public page fell back to when there was no row. Absurdly long names are
  -- left alone rather than truncated mid-word — the owner can write their own.
  v_title := case
    when length(coalesce(trim(new.name), '')) between 1 and 100
      then trim(new.name) || ' Help Center'
    else 'Help Center'
  end;

  begin
    insert into public.help_center_settings (company_id, slug, title)
    values (new.id, public.help_center_default_handle(new.id), v_title)
    on conflict (company_id) do nothing;
  exception
    when unique_violation then
      -- Two companies created in the same instant can derive the same handle:
      -- neither transaction can see the other's uncommitted row, so the unique
      -- index is what tells them apart. The loser takes a suffixed handle.
      begin
        insert into public.help_center_settings (company_id, slug, title)
        values (
          new.id,
          rtrim(left(public.help_center_handle_base(new.slug, new.name, new.id), 70), '-')
            || '-' || left(md5(new.id::text), 6),
          v_title
        )
        on conflict (company_id) do nothing;
      exception when others then
        raise warning 'help centre defaults: no settings row for company % (%)', new.id, sqlerrm;
      end;
    when others then
      -- A signup must never fail because the help centre could not be seeded.
      -- The company exists, the dashboard shows it has no address, and saving
      -- the settings form fills one in.
      raise warning 'help centre defaults: no settings row for company % (%)', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_companies_help_center_defaults on public.companies;
create trigger trg_companies_help_center_defaults
  after insert on public.companies
  for each row execute function public.help_center_seed_settings();

-- --- The companies already here ---------------------------------------------

-- One statement per company rather than one set-based update, because every
-- candidate has to be checked against the handles taken by the rows written
-- moments earlier in this same loop. A single `update … from` would evaluate
-- every row against the snapshot it started with and hand the same handle to
-- two companies called the same thing.
-- Every write is also wrapped in its own handler. Companies are being created
-- while this runs — there are customers on this database today — and one signup
-- committing a handle between a candidate being chosen and being written must
-- cost that one company a suffix, not roll the whole backfill back.
do $$
declare
  rec record;
  v_handle text;
  v_title text;
begin
  -- Rows that exist but where nobody ever filled the address in.
  for rec in
    select s.company_id
      from public.help_center_settings s
     where s.slug is null
     order by s.created_at, s.company_id
  loop
    v_handle := public.help_center_default_handle(rec.company_id);
    continue when v_handle is null;

    begin
      update public.help_center_settings
         set slug = v_handle
       where company_id = rec.company_id
         and slug is null;
    exception when unique_violation then
      update public.help_center_settings
         set slug = rtrim(left(v_handle, 70), '-') || '-' || left(md5(rec.company_id::text), 6)
       where company_id = rec.company_id
         and slug is null;
    end;
  end loop;

  -- And the great majority: companies with no settings row at all.
  for rec in
    select c.id, c.name
      from public.companies c
     where not exists (
       select 1 from public.help_center_settings s where s.company_id = c.id
     )
     order by c.created_at, c.id
  loop
    v_handle := public.help_center_default_handle(rec.id);
    v_title := case
      when length(coalesce(trim(rec.name), '')) between 1 and 100
        then trim(rec.name) || ' Help Center'
      else 'Help Center'
    end;

    begin
      insert into public.help_center_settings (company_id, slug, title)
      values (rec.id, v_handle, v_title)
      on conflict (company_id) do nothing;
    exception when unique_violation then
      insert into public.help_center_settings (company_id, slug, title)
      values (
        rec.id,
        rtrim(left(v_handle, 70), '-') || '-' || left(md5(rec.id::text), 6),
        v_title
      )
      on conflict (company_id) do nothing;
    end;
  end loop;
end$$;

comment on column public.help_center_settings.slug is
  'The canonical public handle: /help/<slug>. Derived from companies.slug by migration 0087 when nobody picks one, so every company is reachable; the owner can change it in the dashboard. Globally unique — it is the whole path segment.';

comment on function public.help_center_seed_settings() is
  'Gives a newly created company a help-centre row with a handle derived from its slug (migration 0087). Warns rather than raises: a signup must not fail because the help centre could not be seeded.';
