-- ===========================================================================
-- Migration 0029 - Application Error Logs
-- Super-admin-only operational error log for API, widget, integration, cron,
-- AI provider, and client-side failures.
-- ===========================================================================

create table if not exists public.application_error_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  user_id         uuid references public.users(id) on delete set null,
  bot_id          uuid references public.bots(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  source          text not null default 'server',
  severity        text not null default 'error'
                    check (severity in ('info','warning','error','critical')),
  message         text not null,
  stack           text,
  route           text,
  status_code     integer,
  fingerprint     text,
  metadata_json   jsonb not null default '{}'::jsonb,
  resolved_at     timestamptz,
  resolved_by     uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_application_error_logs_created
  on public.application_error_logs(created_at desc);
create index if not exists idx_application_error_logs_company_created
  on public.application_error_logs(company_id, created_at desc);
create index if not exists idx_application_error_logs_source_created
  on public.application_error_logs(source, created_at desc);
create index if not exists idx_application_error_logs_severity_created
  on public.application_error_logs(severity, created_at desc);
create index if not exists idx_application_error_logs_unresolved
  on public.application_error_logs(created_at desc) where resolved_at is null;

alter table public.application_error_logs enable row level security;

drop policy if exists application_error_logs_super_admin_all on public.application_error_logs;
create policy application_error_logs_super_admin_all
  on public.application_error_logs
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
