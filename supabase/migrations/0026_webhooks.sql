-- ===========================================================================
-- Migration 0026 — Outbound webhooks & Slack (company integrations)
-- Lets a company push lead.created / appointment.created / order.created events
-- into their OWN systems (generic signed webhook, Slack, or via Zapier/Make).
-- Delivery rows are kept so usage can be metered (server-cost control) and
-- shown in a delivery log.
-- ===========================================================================

create table if not exists public.webhook_endpoints (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            text not null default 'generic' check (kind in ('generic', 'slack')),
  -- The destination URL is a credential (esp. Slack) → stored encrypted.
  url_encrypted   text not null,
  url_preview     text not null default '',
  -- HMAC signing secret (generic endpoints only) — shown once to the company.
  secret          text,
  events          text[] not null default '{}',
  active          boolean not null default true,
  label           text,
  last_delivery_at timestamptz,
  last_status     text,
  failure_count   integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists webhook_endpoints_company_idx
  on public.webhook_endpoints (company_id);

create table if not exists public.webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  endpoint_id  uuid references public.webhook_endpoints(id) on delete cascade,
  event        text not null,
  status       text not null check (status in ('success', 'failed', 'skipped')),
  status_code  integer,
  attempts     integer not null default 1,
  created_at   timestamptz not null default now()
);
-- Composite index supports the monthly usage count (company + time window).
create index if not exists webhook_deliveries_company_time_idx
  on public.webhook_deliveries (company_id, created_at desc);

-- RLS — members may read their own company's rows; writes happen via the
-- service-role backend only (mirrors integration_accounts).
do $$
declare t text;
begin
  foreach t in array array['webhook_endpoints', 'webhook_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end $$;
