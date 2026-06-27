-- ===========================================================================
-- Migration 0024 - Credit ledger, commercial charges, and add-ons
-- Tracks customer prepaid AI credit separately from internal provider cost so
-- super-admins can protect margin and answer "who used what?".
-- ===========================================================================

create table if not exists public.company_credit_accounts (
  company_id              uuid primary key references public.companies(id) on delete cascade,
  currency                text not null default 'GBP',
  balance_amount          numeric(12,4) not null default 0,
  lifetime_credit_added   numeric(12,4) not null default 0,
  lifetime_usage_charged  numeric(12,4) not null default 0,
  low_balance_threshold   numeric(12,4) not null default 2,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists trg_company_credit_accounts_updated_at on public.company_credit_accounts;
create trigger trg_company_credit_accounts_updated_at before update on public.company_credit_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.company_credit_transactions (
  id                 uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  type                text not null check (type in (
                        'top_up','included_credit','ai_usage','manual_adjustment',
                        'refund','bonus'
                      )),
  amount              numeric(12,4) not null,
  currency            text not null default 'GBP',
  provider_cost_usd   numeric(12,6),
  ai_usage_log_id     uuid references public.ai_usage_logs(id) on delete set null,
  description         text,
  metadata_json       jsonb not null default '{}'::jsonb,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists idx_credit_transactions_company on public.company_credit_transactions(company_id, created_at desc);
create index if not exists idx_credit_transactions_usage_log on public.company_credit_transactions(ai_usage_log_id);

create table if not exists public.company_addons (
  id             uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  key             text not null,
  label           text not null,
  price_monthly   numeric(12,2) not null default 0,
  currency        text not null default 'GBP',
  status          text not null default 'active' check (status in ('active','inactive')),
  metadata_json   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(company_id, key)
);

drop trigger if exists trg_company_addons_updated_at on public.company_addons;
create trigger trg_company_addons_updated_at before update on public.company_addons
  for each row execute function public.set_updated_at();

create table if not exists public.company_commercial_charges (
  id             uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  charge_type     text not null check (charge_type in (
                    'setup_fee','api_webhooks_addon','custom_integration',
                    'extra_messages','extra_assistant','manual'
                  )),
  amount          numeric(12,2) not null,
  currency        text not null default 'GBP',
  status          text not null default 'quoted' check (status in ('quoted','invoiced','paid','waived')),
  description     text,
  metadata_json   jsonb not null default '{}'::jsonb,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_commercial_charges_company on public.company_commercial_charges(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'company_credit_accounts',
    'company_credit_transactions',
    'company_addons',
    'company_commercial_charges'
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

insert into public.legal_documents (key,title,content)
values (
  'data_processing',
  'Data Processing Notice',
  'This platform processes business knowledge, chat messages, leads, appointments, and operational data so AI assistants and authorised human agents can answer customers. Upload only data you have permission to use. Do not upload payment card numbers, passwords, special category data, or unnecessary personal information. We use data minimisation, access controls, audit logs, retention controls, and deletion/export workflows to support UK GDPR obligations. Customers remain responsible for their own privacy notices and lawful basis for data they add to the platform.'
)
on conflict (key) do nothing;
