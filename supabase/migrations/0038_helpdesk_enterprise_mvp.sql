-- ===========================================================================
-- Migration 0038 - Help Desk Enterprise MVP Controls
-- Simple admin controls without a heavy role/permission matrix:
--   * keep connector doc approvals stable unless the software map changes
--   * let admins edit/review connector docs in a clean preview workflow
--   * record Help Desk action/chat audit events separately from customer chat
-- ===========================================================================

alter table public.helpdesk_connector_documents
  add column if not exists change_type text not null default 'new'
    check (change_type in ('new','unchanged','updated','ignored')),
  add column if not exists previous_source_json jsonb,
  add column if not exists review_note text,
  add column if not exists ignored_at timestamptz;

alter table public.helpdesk_connector_actions
  add column if not exists admin_label text,
  add column if not exists admin_note text;

create table if not exists public.helpdesk_action_audit_logs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  connector_id          uuid references public.helpdesk_connectors(id) on delete set null,
  action_id             uuid references public.helpdesk_connector_actions(id) on delete set null,
  event_id              uuid references public.helpdesk_connector_events(id) on delete set null,
  actor_user_id         uuid references public.users(id) on delete set null,
  source                text not null default 'chat'
                          check (source in ('chat','dashboard','connector','system')),
  action_name           text,
  question              text,
  answer                text,
  confirmation_required boolean not null default false,
  confirmed             boolean not null default false,
  dry_run               boolean not null default false,
  status                text not null default 'info'
                          check (status in ('info','queued','running','completed','failed','cancelled','confirmation_required')),
  input_json            jsonb not null default '{}'::jsonb,
  response_json         jsonb,
  error_message         text,
  delivery_mode         text,
  metadata_json         jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index if not exists idx_helpdesk_action_audit_company_created
  on public.helpdesk_action_audit_logs(company_id, created_at desc);

create index if not exists idx_helpdesk_action_audit_event
  on public.helpdesk_action_audit_logs(event_id);

alter table public.helpdesk_action_audit_logs enable row level security;

drop policy if exists helpdesk_action_audit_logs_super_admin_all on public.helpdesk_action_audit_logs;
create policy helpdesk_action_audit_logs_super_admin_all on public.helpdesk_action_audit_logs
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists helpdesk_action_audit_logs_select_members on public.helpdesk_action_audit_logs;
create policy helpdesk_action_audit_logs_select_members on public.helpdesk_action_audit_logs
  for select to authenticated using (company_id in (select public.user_company_ids()));
