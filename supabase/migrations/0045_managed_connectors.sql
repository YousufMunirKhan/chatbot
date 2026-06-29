-- ===========================================================================
-- Migration 0045 — Managed (cloud) connectors
-- For SaaS platforms reachable from our server (Shopify/Square/Foodics), the app
-- executes Help Desk actions directly using stored credentials — so onboarding
-- is "paste a token", not "run an SDK process". Each managed connector is backed
-- by a normal helpdesk_connectors row (so docs/actions/audit all work the same).
-- ===========================================================================

create table if not exists public.managed_connectors (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  connector_id         uuid not null references public.helpdesk_connectors(id) on delete cascade,
  platform             text not null check (platform in ('shopify','square','foodics')),
  credentials_encrypted text not null,
  status               text not null default 'active' check (status in ('active','paused')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists uq_managed_connectors_connector on public.managed_connectors(connector_id);
create index if not exists idx_managed_connectors_company on public.managed_connectors(company_id, status);

alter table public.managed_connectors enable row level security;

drop policy if exists managed_connectors_super_admin_all on public.managed_connectors;
create policy managed_connectors_super_admin_all on public.managed_connectors
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists managed_connectors_select_members on public.managed_connectors;
create policy managed_connectors_select_members on public.managed_connectors
  for select to authenticated using (company_id in (select public.user_company_ids()));
