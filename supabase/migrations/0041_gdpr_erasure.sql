-- ===========================================================================
-- Migration 0041 — GDPR erasure execution + audit
-- data_subject_requests (0018) records the ask; retention purge runs via
-- cleanup_old_chats() (0012). This adds an accountability trail for actual
-- erasures and a processed_by marker on the request.
-- ===========================================================================

alter table public.data_subject_requests
  add column if not exists processed_by uuid references public.users(id) on delete set null;

create table if not exists public.data_erasure_logs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  request_id            uuid references public.data_subject_requests(id) on delete set null,
  requester_email       text not null,
  conversations_deleted integer not null default 0,
  leads_deleted         integer not null default 0,
  appointments_deleted  integer not null default 0,
  actor_user_id         uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_data_erasure_logs_company_created
  on public.data_erasure_logs(company_id, created_at desc);

alter table public.data_erasure_logs enable row level security;

drop policy if exists data_erasure_logs_super_admin_all on public.data_erasure_logs;
create policy data_erasure_logs_super_admin_all on public.data_erasure_logs
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists data_erasure_logs_select_members on public.data_erasure_logs;
create policy data_erasure_logs_select_members on public.data_erasure_logs
  for select to authenticated using (company_id in (select public.user_company_ids()));
