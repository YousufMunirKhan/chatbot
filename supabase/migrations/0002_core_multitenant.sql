-- ===========================================================================
-- Migration 0002 — Core multi-tenant schema & settings system
-- Module 2.
-- Tables: users, companies, company_users, roles, permissions, bots,
--         bot_settings, platform_settings, company_settings, audit_logs.
-- Multi-tenant isolation: every tenant row carries company_id; RLS scopes rows
-- to the caller's company (baseline policies here, refined in Module 3).
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Helper: keep updated_at fresh
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- roles  (seeded reference data)
-- --------------------------------------------------------------------------
create table if not exists public.roles (
  key         text primary key,
  description text
);

insert into public.roles (key, description) values
  ('super_admin',   'Platform owner — access to all companies and platform data'),
  ('company_admin', 'Company owner/admin — manages a single company'),
  ('agent',         'Support/sales agent — handles permitted conversations')
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- permissions  (seeded reference data; assigned via company_users.permissions_json)
-- --------------------------------------------------------------------------
create table if not exists public.permissions (
  key         text primary key,
  description text
);

insert into public.permissions (key, description) values
  ('inbox.view',        'View the business inbox'),
  ('inbox.reply',       'Reply to conversations / take over from AI'),
  ('leads.view',        'View leads'),
  ('leads.export',      'Export leads to CSV'),
  ('orders.view',       'View orders / order enquiries'),
  ('appointments.view', 'View appointment requests'),
  ('billing.manage',    'Manage subscription & billing'),
  ('integrations.manage','Connect & configure integrations'),
  ('bots.manage',       'Create & configure assistants'),
  ('agents.manage',     'Manage team / agents')
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- users  (app-level user profile)
-- NOTE: In Module 3 this is reconciled with Supabase auth.users — id will equal
-- auth.users.id. For now it stands alone so the schema is usable pre-auth.
-- --------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  full_name  text,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- companies  (tenant root)
-- --------------------------------------------------------------------------
create table if not exists public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  website          text,
  country          text,
  timezone         text,
  default_language text not null default 'auto'
                     check (default_language in ('en','ar','auto')),
  status           text not null default 'active'
                     check (status in ('active','suspended')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- company_users  (membership + role + granular permissions)
-- --------------------------------------------------------------------------
create table if not exists public.company_users (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  role             text not null references public.roles(key),
  permissions_json jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (company_id, user_id)
);

create index if not exists idx_company_users_company on public.company_users(company_id);
create index if not exists idx_company_users_user    on public.company_users(user_id);

-- --------------------------------------------------------------------------
-- bots / assistants
-- --------------------------------------------------------------------------
create table if not exists public.bots (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null,
  bot_type         text not null default 'hybrid_business_assistant'
                     check (bot_type in ('help_desk','sales_agent','hybrid_business_assistant','informational','custom')),
  system_prompt    text,
  language_default text not null default 'auto'
                     check (language_default in ('en','ar','auto')),
  appearance_json  jsonb not null default '{}'::jsonb,
  capability_flags text[] not null default '{}',
  public_bot_id    text not null unique default replace(gen_random_uuid()::text,'-',''),
  domain_allowlist text[] not null default '{}',
  ai_enabled       boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_bots_company on public.bots(company_id);

drop trigger if exists trg_bots_updated_at on public.bots;
create trigger trg_bots_updated_at before update on public.bots
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- Settings: platform (global) / company / bot
-- Resolution order, most-specific-first: bot → company → platform → env default
-- --------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value_json jsonb not null,
  is_secret  boolean not null default false,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_platform_settings_updated_at on public.platform_settings;
create trigger trg_platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

create table if not exists public.company_settings (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null,
  value_json jsonb not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create index if not exists idx_company_settings_company on public.company_settings(company_id);

drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

create table if not exists public.bot_settings (
  id         uuid primary key default gen_random_uuid(),
  bot_id     uuid not null references public.bots(id) on delete cascade,
  key        text not null,
  value_json jsonb not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  unique (bot_id, key)
);

create index if not exists idx_bot_settings_bot on public.bot_settings(bot_id);

drop trigger if exists trg_bot_settings_updated_at on public.bot_settings;
create trigger trg_bot_settings_updated_at before update on public.bot_settings
  for each row execute function public.set_updated_at();

-- Seed sensible platform defaults (non-secret) for the AI provider layer.
insert into public.platform_settings (key, value_json, is_secret) values
  ('ai.chat_provider',          to_jsonb('openai'::text), false),
  ('ai.chat_model',             to_jsonb('gpt-4o-mini'::text), false),
  ('ai.advanced_chat_model',    to_jsonb('gpt-4o'::text), false),
  ('ai.embedding_provider',     to_jsonb('openai'::text), false),
  ('ai.embedding_model',        to_jsonb('text-embedding-3-large'::text), false),
  ('ai.rerank_provider',        to_jsonb('cohere'::text), false),
  ('ai.rerank_model',           to_jsonb('rerank-multilingual-v3.0'::text), false),
  ('chat.retention_days',       to_jsonb(30), false)
on conflict (key) do nothing;

-- --------------------------------------------------------------------------
-- audit_logs  (super-admin actions, impersonation, sensitive changes)
-- --------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_logs_company on public.audit_logs(company_id);
create index if not exists idx_audit_logs_actor   on public.audit_logs(actor_user_id);

-- ===========================================================================
-- Row Level Security (baseline — refined in Module 3 once auth is wired)
-- The service-role / secret key BYPASSES RLS, so backend jobs and the
-- super-admin (currently using the secret key) keep full access. These policies
-- govern the `authenticated` role once users log in.
-- ===========================================================================

-- Returns the set of company_ids the current authenticated user belongs to.
-- Convention (finalized in Module 3): public.users.id = auth.users.id = auth.uid()
create or replace function public.user_company_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.company_users where user_id = auth.uid();
$$;

alter table public.companies        enable row level security;
alter table public.company_users    enable row level security;
alter table public.bots             enable row level security;
alter table public.bot_settings     enable row level security;
alter table public.company_settings enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.users            enable row level security;
alter table public.platform_settings enable row level security;

-- companies: members can read their own company.
drop policy if exists companies_select_members on public.companies;
create policy companies_select_members on public.companies
  for select to authenticated
  using (id in (select public.user_company_ids()));

-- company_users: members can read membership rows of their companies.
drop policy if exists company_users_select_members on public.company_users;
create policy company_users_select_members on public.company_users
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

-- bots: members can read their company's bots.
drop policy if exists bots_select_members on public.bots;
create policy bots_select_members on public.bots
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

-- bot_settings: members can read settings of their company's bots.
drop policy if exists bot_settings_select_members on public.bot_settings;
create policy bot_settings_select_members on public.bot_settings
  for select to authenticated
  using (bot_id in (select id from public.bots where company_id in (select public.user_company_ids())));

-- company_settings: members can read their company's settings.
drop policy if exists company_settings_select_members on public.company_settings;
create policy company_settings_select_members on public.company_settings
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

-- audit_logs: members can read their company's audit trail.
drop policy if exists audit_logs_select_members on public.audit_logs;
create policy audit_logs_select_members on public.audit_logs
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

-- users: a user can read their own profile row.
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = auth.uid());

-- platform_settings: NO authenticated policy on purpose — only the service-role
-- (super admin / backend) may read/write until Module 3 adds a super_admin check.
