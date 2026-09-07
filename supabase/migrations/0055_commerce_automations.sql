-- ===========================================================================
-- Migration 0055 — E-commerce automations (Shopify + WooCommerce)
-- Post-purchase and abandoned-cart messaging. A rule says "when THIS happens,
-- wait N minutes, then send THIS message on THIS channel"; a run is one
-- (rule, entity) pair claimed by the dispatcher. The unique index on
-- (rule_id, entity_type, entity_id) is the whole safety story: store webhooks
-- retry aggressively, so the same order must never be able to trigger the same
-- rule twice no matter how many deliveries arrive.
-- ===========================================================================

create table if not exists public.automation_rules (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null default '',
  trigger_event    text not null check (trigger_event in (
                     'order_created','order_paid','order_shipped','order_delivered',
                     'order_cancelled','order_refunded','cart_abandoned','customer_created')),
  channel          text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  template_name    text,
  message_template text not null default '',
  delay_minutes    integer not null default 0 check (delay_minutes >= 0),
  conditions_json  jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists idx_automation_rules_company on public.automation_rules(company_id, created_at desc);
create index if not exists idx_automation_rules_trigger
  on public.automation_rules(company_id, trigger_event) where is_active;

create table if not exists public.automation_runs (
  id            bigserial primary key,
  company_id    uuid not null references public.companies(id) on delete cascade,
  rule_id       uuid not null references public.automation_rules(id) on delete cascade,
  entity_type   text not null default 'order',
  entity_id     text not null,
  status        text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  error         text,
  payload_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
-- One message per rule per entity, forever. Webhook retries and cron overlap
-- both land on this constraint instead of on the customer's phone.
create unique index if not exists idx_automation_runs_unique
  on public.automation_runs(rule_id, entity_type, entity_id);
create index if not exists idx_automation_runs_due
  on public.automation_runs(status, scheduled_for) where status = 'pending';
create index if not exists idx_automation_runs_company on public.automation_runs(company_id, created_at desc);

-- Store webhooks carry no tenant in their payload, so the URL does: the company
-- registers `/api/webhooks/store/shopify?t=<webhook_token>`. Random, revocable,
-- and unique across the platform so a token can only ever resolve to one tenant.
alter table public.integration_accounts add column if not exists webhook_token text;
create unique index if not exists idx_integration_accounts_webhook_token
  on public.integration_accounts(webhook_token) where webhook_token is not null;

-- Abandoned-cart lifecycle on the existing conversational cart table.
-- `external_id` + `metadata_json` let a store checkout (Shopify checkouts/create)
-- land in the same table as a chat cart, so one detector covers both.
alter table public.chat_carts add column if not exists abandoned_at timestamptz;
alter table public.chat_carts add column if not exists recovered_at timestamptz;
alter table public.chat_carts add column if not exists recovery_sent_at timestamptz;
alter table public.chat_carts add column if not exists external_id text;
alter table public.chat_carts add column if not exists metadata_json jsonb not null default '{}'::jsonb;
create index if not exists idx_chat_carts_abandon_scan
  on public.chat_carts(company_id, status, updated_at);
create unique index if not exists idx_chat_carts_external
  on public.chat_carts(company_id, external_id) where external_id is not null;

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists automation_rules_super_admin_all on public.automation_rules;
create policy automation_rules_super_admin_all on public.automation_rules
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists automation_rules_select_members on public.automation_rules;
create policy automation_rules_select_members on public.automation_rules
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists automation_runs_super_admin_all on public.automation_runs;
create policy automation_runs_super_admin_all on public.automation_runs
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists automation_runs_select_members on public.automation_runs;
create policy automation_runs_select_members on public.automation_runs
  for select to authenticated using (company_id in (select public.user_company_ids()));
