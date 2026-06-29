-- ===========================================================================
-- Migration 0035 - Connector Delivery Observability
-- Tracks connector delivery mode, polling fallback, connection health, and
-- action/event lifecycle so connector behavior is visible on our server.
-- ===========================================================================

alter table public.helpdesk_connectors
  add column if not exists preferred_delivery_mode text not null default 'websocket'
    check (preferred_delivery_mode in ('direct_api','websocket','polling_fallback','manual')),
  add column if not exists active_delivery_mode text not null default 'polling_fallback'
    check (active_delivery_mode in ('direct_api','websocket','polling_fallback','manual')),
  add column if not exists connection_state text not null default 'unknown'
    check (connection_state in ('unknown','connected','degraded','fallback','offline')),
  add column if not exists last_connected_at timestamptz,
  add column if not exists last_disconnected_at timestamptz,
  add column if not exists last_poll_at timestamptz,
  add column if not exists poll_interval_seconds integer not null default 60,
  add column if not exists fallback_reason text,
  add column if not exists last_health_at timestamptz,
  add column if not exists last_error text;

create index if not exists idx_helpdesk_connectors_delivery
  on public.helpdesk_connectors(company_id, active_delivery_mode, connection_state);

create table if not exists public.helpdesk_connector_health_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  connector_id    uuid not null references public.helpdesk_connectors(id) on delete cascade,
  event_type      text not null,
  delivery_mode   text check (delivery_mode in ('direct_api','websocket','polling_fallback','manual')),
  status          text not null default 'info' check (status in ('info','success','warning','error')),
  message         text,
  event_id        uuid references public.helpdesk_connector_events(id) on delete set null,
  action_name     text,
  duration_ms     integer,
  poll_interval_seconds integer,
  events_returned integer,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_helpdesk_health_connector_time
  on public.helpdesk_connector_health_logs(connector_id, created_at desc);

create index if not exists idx_helpdesk_health_company_time
  on public.helpdesk_connector_health_logs(company_id, created_at desc);

create index if not exists idx_helpdesk_health_event_type
  on public.helpdesk_connector_health_logs(company_id, event_type, created_at desc);

alter table public.helpdesk_connector_health_logs enable row level security;

drop policy if exists helpdesk_connector_health_logs_super_admin_all on public.helpdesk_connector_health_logs;
create policy helpdesk_connector_health_logs_super_admin_all on public.helpdesk_connector_health_logs
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists helpdesk_connector_health_logs_select_members on public.helpdesk_connector_health_logs;
create policy helpdesk_connector_health_logs_select_members on public.helpdesk_connector_health_logs
  for select to authenticated
  using (company_id in (select public.user_company_ids()));
