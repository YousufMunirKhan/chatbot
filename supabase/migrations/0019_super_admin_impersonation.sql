-- ===========================================================================
-- Migration 0019 - Super Admin time-limited impersonation
-- Sensitive support access with explicit reason, expiry, ending state, and logs.
-- ===========================================================================

create table if not exists public.super_admin_impersonation_sessions (
  id              uuid primary key default gen_random_uuid(),
  super_admin_id  uuid not null references public.users(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  reason          text not null,
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_impersonation_super_admin on public.super_admin_impersonation_sessions(super_admin_id, created_at desc);
create index if not exists idx_impersonation_company on public.super_admin_impersonation_sessions(company_id, created_at desc);
create index if not exists idx_impersonation_active on public.super_admin_impersonation_sessions(id, expires_at) where ended_at is null;

alter table public.super_admin_impersonation_sessions enable row level security;
drop policy if exists impersonation_sessions_super_admin_all on public.super_admin_impersonation_sessions;
create policy impersonation_sessions_super_admin_all on public.super_admin_impersonation_sessions
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
