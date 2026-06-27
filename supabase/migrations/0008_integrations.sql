-- ===========================================================================
-- Migration 0008 — Integrations & Sync (Module 14)
-- integration_accounts (encrypted credentials) + sync_jobs.
-- ===========================================================================

create table if not exists public.integration_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  provider              text not null
                          check (provider in ('shopify','woocommerce','csv','custom_api','pos','crm')),
  name                  text not null default '',
  status                text not null default 'connected'
                          check (status in ('connected','error','disconnected')),
  credentials_encrypted text,
  settings_json         jsonb not null default '{}'::jsonb,
  last_sync_at          timestamptz,
  next_sync_at          timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists idx_integration_accounts_company on public.integration_accounts(company_id);

create table if not exists public.sync_jobs (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  integration_account_id uuid references public.integration_accounts(id) on delete cascade,
  job_type               text not null default 'full',
  status                 text not null default 'pending'
                           check (status in ('pending','running','completed','failed')),
  records_processed      integer not null default 0,
  error_message          text,
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists idx_sync_jobs_company on public.sync_jobs(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['integration_accounts','sync_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end$$;

-- NOTE: credentials_encrypted is written/read only by the backend via
-- @/lib/crypto (AES-256-GCM); the column is never exposed to non-super-admins
-- in the UI. The select policy lets members see metadata (provider/status/sync).
