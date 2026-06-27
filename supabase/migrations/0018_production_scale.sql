-- ===========================================================================
-- Migration 0018 - Production SaaS scale foundations
-- Optional 2FA, security audit, billing mappings/overage, agent ops, AI budget,
-- answer cache, jobs/dead-letter, legal/data requests, and calendar availability.
-- ===========================================================================

create table if not exists public.user_security_settings (
  user_id              uuid primary key references public.users(id) on delete cascade,
  two_factor_enabled   boolean not null default false,
  two_factor_method    text not null default 'email' check (two_factor_method in ('email')),
  pending_code_hash    text,
  pending_expires_at   timestamptz,
  two_factor_verified_at timestamptz,
  last_login_at        timestamptz,
  last_login_ip        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
drop trigger if exists trg_user_security_settings_updated_at on public.user_security_settings;
create trigger trg_user_security_settings_updated_at before update on public.user_security_settings
  for each row execute function public.set_updated_at();

create table if not exists public.security_audit_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete set null,
  user_id        uuid references public.users(id) on delete set null,
  event_type     text not null,
  ip_address     text,
  user_agent     text,
  metadata_json  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_security_audit_created on public.security_audit_logs(created_at desc);
create index if not exists idx_security_audit_user on public.security_audit_logs(user_id, created_at desc);

create table if not exists public.stripe_price_mappings (
  id                 uuid primary key default gen_random_uuid(),
  plan               text not null unique,
  stripe_price_id    text not null,
  overage_price_id   text,
  enabled            boolean not null default true,
  updated_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists trg_stripe_price_mappings_updated_at on public.stripe_price_mappings;
create trigger trg_stripe_price_mappings_updated_at before update on public.stripe_price_mappings
  for each row execute function public.set_updated_at();

alter table public.subscriptions add column if not exists overage_enabled boolean not null default false;
alter table public.subscriptions add column if not exists overage_unit_price numeric(10,4);
alter table public.subscriptions add column if not exists payment_failed_at timestamptz;

create table if not exists public.agent_presence (
  user_id       uuid not null references public.users(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  status        text not null default 'offline' check (status in ('online','away','offline')),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index if not exists idx_agent_presence_company on public.agent_presence(company_id, status, last_seen_at desc);

create table if not exists public.conversation_internal_notes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid references public.users(id) on delete set null,
  note            text not null,
  created_at      timestamptz not null default now()
);
alter table public.conversations add column if not exists priority text not null default 'normal' check (priority in ('low','normal','high','urgent'));
alter table public.conversations add column if not exists tags text[] not null default '{}';
alter table public.conversations add column if not exists first_agent_reply_at timestamptz;

create table if not exists public.company_ai_budgets (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  monthly_budget_usd  numeric(12,4),
  hard_stop_enabled   boolean not null default false,
  fallback_provider   text,
  fallback_model      text,
  cache_enabled       boolean not null default true,
  updated_by          uuid references public.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create table if not exists public.ai_answer_cache (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  bot_id         uuid references public.bots(id) on delete cascade,
  question_hash  text not null,
  answer         text not null,
  model          text,
  provider       text,
  hit_count      integer not null default 0,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique(company_id, bot_id, question_hash)
);
create index if not exists idx_ai_answer_cache_lookup on public.ai_answer_cache(company_id, bot_id, question_hash);

create table if not exists public.background_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete cascade,
  type           text not null,
  status         text not null default 'queued' check (status in ('queued','running','completed','failed','dead_letter')),
  payload_json   jsonb not null default '{}'::jsonb,
  attempts       integer not null default 0,
  max_attempts   integer not null default 3,
  run_after      timestamptz not null default now(),
  last_error     text,
  locked_at      timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_background_jobs_due on public.background_jobs(status, run_after, created_at);

create table if not exists public.dead_letter_jobs (
  id             uuid primary key default gen_random_uuid(),
  original_job_id uuid,
  company_id     uuid references public.companies(id) on delete set null,
  type           text not null,
  payload_json   jsonb not null default '{}'::jsonb,
  error_message  text,
  failed_at      timestamptz not null default now()
);

create table if not exists public.data_subject_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete cascade,
  requester_email text not null,
  request_type   text not null check (request_type in ('export','delete')),
  status         text not null default 'open' check (status in ('open','processing','completed','rejected')),
  notes          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create table if not exists public.legal_documents (
  key            text primary key,
  title          text not null,
  content        text not null,
  version        integer not null default 1,
  published_at   timestamptz not null default now(),
  updated_by     uuid references public.users(id) on delete set null
);
insert into public.legal_documents (key,title,content)
values
  ('terms','Terms of Service','Use of this AI chat platform is subject to your commercial agreement and acceptable-use rules.'),
  ('privacy','Privacy Policy','This platform processes chat, lead, appointment, and account data to provide AI and human support features.'),
  ('ai_disclosure','AI Disclosure','Visitors may interact with AI-generated responses. Human agents can join where enabled.')
on conflict (key) do nothing;

alter table public.google_calendar_events add column if not exists start_at timestamptz;
alter table public.google_calendar_events add column if not exists end_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array[
    'user_security_settings','security_audit_logs','stripe_price_mappings','agent_presence',
    'conversation_internal_notes','company_ai_budgets','ai_answer_cache','background_jobs',
    'dead_letter_jobs','data_subject_requests','legal_documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all',
      t
    );
  end loop;
end$$;

drop policy if exists agent_presence_select_members on public.agent_presence;
create policy agent_presence_select_members on public.agent_presence
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists conversation_internal_notes_select_members on public.conversation_internal_notes;
create policy conversation_internal_notes_select_members on public.conversation_internal_notes
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists company_ai_budgets_select_members on public.company_ai_budgets;
create policy company_ai_budgets_select_members on public.company_ai_budgets
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists data_subject_requests_select_members on public.data_subject_requests;
create policy data_subject_requests_select_members on public.data_subject_requests
  for select to authenticated using (company_id in (select public.user_company_ids()));
drop policy if exists legal_documents_public_read on public.legal_documents;
create policy legal_documents_public_read on public.legal_documents for select to anon, authenticated using (true);
