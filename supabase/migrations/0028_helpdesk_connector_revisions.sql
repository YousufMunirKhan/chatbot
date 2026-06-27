-- ===========================================================================
-- Migration 0028 - Help Desk Connector Revisions
-- Lets the platform tell installed connectors when dashboard/bot-side connector
-- configuration changed and a manifest resync is needed.
-- ===========================================================================

alter table public.helpdesk_connectors
  add column if not exists manifest_revision integer not null default 1,
  add column if not exists resync_requested_at timestamptz,
  add column if not exists last_client_revision integer not null default 0;

create index if not exists idx_helpdesk_connectors_resync
  on public.helpdesk_connectors(company_id, resync_requested_at desc);
