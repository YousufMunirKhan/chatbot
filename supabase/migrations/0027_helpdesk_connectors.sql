-- ===========================================================================
-- Migration 0027 - Help Desk Connectors
-- Stores approved software-help documentation and action manifests.
-- Live POS/app data stays in the customer's environment and is accessed
-- through connector events only.
-- ===========================================================================

create table if not exists public.helpdesk_connectors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  public_id         text not null unique default ('hconn_' || encode(gen_random_bytes(12), 'hex')),
  platform          text not null check (platform in ('dotnet','android','web','other')),
  name              text not null,
  status            text not null default 'active'
                      check (status in ('active','paused','revoked')),
  token_hash        text not null,
  app_version       text,
  last_seen_at      timestamptz,
  last_sync_at      timestamptz,
  settings_json     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_helpdesk_connectors_company on public.helpdesk_connectors(company_id, created_at desc);
create index if not exists idx_helpdesk_connectors_token on public.helpdesk_connectors(token_hash);

drop trigger if exists trg_helpdesk_connectors_updated_at on public.helpdesk_connectors;
create trigger trg_helpdesk_connectors_updated_at before update on public.helpdesk_connectors
  for each row execute function public.set_updated_at();

create table if not exists public.helpdesk_connector_documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  connector_id   uuid not null references public.helpdesk_connectors(id) on delete cascade,
  external_key   text not null,
  status         text not null default 'draft'
                   check (status in ('draft','approved','rejected')),
  platform       text not null,
  module         text not null,
  screen         text not null,
  path           text,
  purpose        text,
  content        text not null,
  source_json    jsonb not null default '{}'::jsonb,
  reviewed_by    uuid references public.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(connector_id, external_key)
);
create index if not exists idx_helpdesk_docs_company_status on public.helpdesk_connector_documents(company_id, status, updated_at desc);

drop trigger if exists trg_helpdesk_connector_documents_updated_at on public.helpdesk_connector_documents;
create trigger trg_helpdesk_connector_documents_updated_at before update on public.helpdesk_connector_documents
  for each row execute function public.set_updated_at();

create table if not exists public.helpdesk_connector_actions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  connector_id     uuid not null references public.helpdesk_connectors(id) on delete cascade,
  name             text not null,
  description      text not null default '',
  action_type      text not null default 'read'
                     check (action_type in ('read','report','create','update','danger')),
  risk             text not null default 'low'
                     check (risk in ('low','medium','high')),
  required_fields  jsonb not null default '[]'::jsonb,
  optional_fields  jsonb not null default '[]'::jsonb,
  allowed_roles    jsonb not null default '[]'::jsonb,
  needs_confirmation boolean not null default false,
  is_enabled       boolean not null default true,
  schema_json      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(connector_id, name)
);
create index if not exists idx_helpdesk_actions_company on public.helpdesk_connector_actions(company_id, is_enabled, name);

drop trigger if exists trg_helpdesk_connector_actions_updated_at on public.helpdesk_connector_actions;
create trigger trg_helpdesk_connector_actions_updated_at before update on public.helpdesk_connector_actions
  for each row execute function public.set_updated_at();

create table if not exists public.helpdesk_connector_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  connector_id   uuid not null references public.helpdesk_connectors(id) on delete cascade,
  action_id      uuid references public.helpdesk_connector_actions(id) on delete set null,
  event_name     text not null,
  status         text not null default 'queued'
                   check (status in ('queued','running','completed','failed','cancelled')),
  request_json   jsonb not null default '{}'::jsonb,
  response_json  jsonb,
  error_message  text,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  completed_at   timestamptz
);
create index if not exists idx_helpdesk_events_connector_status on public.helpdesk_connector_events(connector_id, status, created_at);
create index if not exists idx_helpdesk_events_company_time on public.helpdesk_connector_events(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'helpdesk_connectors',
    'helpdesk_connector_documents',
    'helpdesk_connector_actions',
    'helpdesk_connector_events'
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

