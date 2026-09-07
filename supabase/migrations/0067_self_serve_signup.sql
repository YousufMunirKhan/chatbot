-- ===========================================================================
-- Migration 0067 — Self-serve signup
-- Records how a company came into existence, so a tenant a stranger opened for
-- themselves at /signup can be told apart from one an operator onboarded by
-- hand or an agency created as a sub-account. Nothing in the product behaves
-- differently on the value today; it exists because the first question anyone
-- asks about an unfamiliar company ("who let these people in?") currently has
-- no answer anywhere in the schema, and because self-serve rows are the ones
-- that need watching for abuse.
-- ===========================================================================

alter table public.companies
  add column if not exists signup_source text not null default 'operator';

-- Added as a named constraint rather than inline so re-running the migration on
-- a database that already has the column is a no-op instead of a duplicate.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_signup_source_check'
  ) then
    alter table public.companies
      add constraint companies_signup_source_check
      check (signup_source in ('operator', 'agency', 'self_serve'));
  end if;
end;
$$;

-- Every company already attached to an agency was created by that agency
-- (migration 0057), so the existing rows can be classified rather than left
-- lying about their origin. Everything else predates self-serve and really was
-- operator-created, which is what the column default already says.
do $$
begin
  if to_regclass('public.agency_companies') is not null then
    update public.companies c
    set signup_source = 'agency'
    from public.agency_companies ac
    where ac.company_id = c.id
      and c.signup_source = 'operator';
  end if;
end;
$$;

-- Partial rather than a plain index on a three-value column: the only query
-- worth an index here is "the self-serve accounts, newest first", which is what
-- an operator reviewing overnight signups asks for.
create index if not exists idx_companies_self_serve
  on public.companies (created_at desc)
  where signup_source = 'self_serve';

comment on column public.companies.signup_source is
  'How this tenant was created: operator (super-admin onboarding), agency (reseller sub-account), or self_serve (public /signup).';
