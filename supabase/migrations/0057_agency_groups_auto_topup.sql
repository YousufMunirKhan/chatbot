-- ===========================================================================
-- Migration 0057 — Agency (white-label) mode, groups, and auto top-up
--
-- Three platform features that all needed new storage, kept in one migration
-- because they share nothing but the tenant they hang off:
--
--   1. agencies / agency_companies — a reseller owns a set of sub-account
--      companies and re-brands the product for them. Branding lives in a jsonb
--      blob so adding a knob (login background, support email, …) never needs a
--      migration; `src/lib/agency.ts` is the one reader and normalises it.
--   2. agent_groups / contact_groups (+ members) — named sets of teammates and
--      of contacts, so broadcasts and ticket routing can target "Support" or
--      "VIP customers" instead of a hand-copied list of ids.
--   3. company_auto_topup (+ attempts) — when prepaid AI credit falls under a
--      threshold, charge a saved Stripe payment method off-session and credit
--      the ledger from 0024. `claimed_at` is the concurrency lock: a charge is
--      only made by the run that wins a conditional update, so two overlapping
--      callers can never double-charge a card.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Agencies (white-label resellers)
-- ---------------------------------------------------------------------------
create table if not exists public.agencies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  owner_user_id  uuid references public.users(id) on delete set null,
  branding_json  jsonb not null default '{}'::jsonb,
  custom_domain  text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
-- A host maps to at most ONE agency so `getAgencyByDomain()` is unambiguous.
create unique index if not exists idx_agencies_custom_domain
  on public.agencies(lower(custom_domain))
  where custom_domain is not null;
create index if not exists idx_agencies_owner on public.agencies(owner_user_id);

-- `unique(company_id)`: a company belongs to at most one agency, so branding
-- resolution never has to pick between two answers.
create table if not exists public.agency_companies (
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (agency_id, company_id),
  unique (company_id)
);
create index if not exists idx_agency_companies_agency on public.agency_companies(agency_id);

-- ---------------------------------------------------------------------------
-- 2. Groups — teammates and contacts
-- ---------------------------------------------------------------------------
create table if not exists public.agent_groups (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists idx_agent_groups_company on public.agent_groups(company_id, created_at desc);

create table if not exists public.agent_group_members (
  group_id    uuid not null references public.agent_groups(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_agent_group_members_user on public.agent_group_members(user_id);

create table if not exists public.contact_groups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  colour      text,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists idx_contact_groups_company on public.contact_groups(company_id, created_at desc);

-- Polymorphic membership: a contact is a lead, a synced commerce customer, or a
-- conversation participant. No FK, so the `contact_type` check plus the
-- company-scoped lookup in `src/lib/groups.ts` is what keeps rows honest.
create table if not exists public.contact_group_members (
  group_id      uuid not null references public.contact_groups(id) on delete cascade,
  contact_type  text not null check (contact_type in ('lead','synced_customer','conversation')),
  contact_id    uuid not null,
  created_at    timestamptz not null default now(),
  primary key (group_id, contact_type, contact_id)
);
create index if not exists idx_contact_group_members_contact
  on public.contact_group_members(contact_type, contact_id);

-- ---------------------------------------------------------------------------
-- 3. Auto top-up
-- ---------------------------------------------------------------------------
create table if not exists public.company_auto_topup (
  company_id                uuid primary key references public.companies(id) on delete cascade,
  is_enabled                boolean not null default false,
  threshold_credits         integer not null default 5,
  topup_amount_cents        integer not null default 2000,
  stripe_payment_method_id  text,
  last_topup_at             timestamptz,
  failure_count             integer not null default 0,
  disabled_reason           text,
  -- Concurrency claim. Set by the conditional update that wins the race and
  -- cleared when the attempt finishes; a stale claim (crashed process) expires
  -- after the TTL in src/lib/billing/auto-topup.ts.
  claimed_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists trg_company_auto_topup_updated_at on public.company_auto_topup;
create trigger trg_company_auto_topup_updated_at before update on public.company_auto_topup
  for each row execute function public.set_updated_at();

-- Every attempt, succeeded or failed. The credit ledger only records money that
-- actually arrived, so failures would otherwise be invisible to the customer.
create table if not exists public.company_auto_topup_attempts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  status             text not null check (status in ('succeeded','failed')),
  amount_cents       integer not null default 0,
  balance_before     numeric(12,4),
  stripe_payment_intent_id text,
  error              text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_auto_topup_attempts_company
  on public.company_auto_topup_attempts(company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Tables that carry `company_id` get the standard pair.
do $$
declare t text;
begin
  foreach t in array array[
    'agent_groups',
    'contact_groups',
    'company_auto_topup',
    'company_auto_topup_attempts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all',
      t
    );
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))',
      t || '_select_members',
      t
    );
  end loop;
end$$;

-- `agencies` has no company_id: an agency is visible to the operator who owns
-- it and to members of any company it has attached.
alter table public.agencies enable row level security;

drop policy if exists agencies_super_admin_all on public.agencies;
create policy agencies_super_admin_all on public.agencies
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists agencies_select_members on public.agencies;
create policy agencies_select_members on public.agencies
  for select to authenticated using (
    owner_user_id = auth.uid()
    or id in (
      select ac.agency_id from public.agency_companies ac
      where ac.company_id in (select public.user_company_ids())
    )
  );

alter table public.agency_companies enable row level security;

drop policy if exists agency_companies_super_admin_all on public.agency_companies;
create policy agency_companies_super_admin_all on public.agency_companies
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists agency_companies_select_members on public.agency_companies;
create policy agency_companies_select_members on public.agency_companies
  for select to authenticated using (
    company_id in (select public.user_company_ids())
    or agency_id in (select a.id from public.agencies a where a.owner_user_id = auth.uid())
  );

-- Membership tables inherit their tenant from the group they point at.
alter table public.agent_group_members enable row level security;

drop policy if exists agent_group_members_super_admin_all on public.agent_group_members;
create policy agent_group_members_super_admin_all on public.agent_group_members
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists agent_group_members_select_members on public.agent_group_members;
create policy agent_group_members_select_members on public.agent_group_members
  for select to authenticated using (
    group_id in (
      select g.id from public.agent_groups g
      where g.company_id in (select public.user_company_ids())
    )
  );

alter table public.contact_group_members enable row level security;

drop policy if exists contact_group_members_super_admin_all on public.contact_group_members;
create policy contact_group_members_super_admin_all on public.contact_group_members
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists contact_group_members_select_members on public.contact_group_members;
create policy contact_group_members_select_members on public.contact_group_members
  for select to authenticated using (
    group_id in (
      select g.id from public.contact_groups g
      where g.company_id in (select public.user_company_ids())
    )
  );
