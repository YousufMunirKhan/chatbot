-- ===========================================================================
-- Migration 0015 - Realtime handoff, agent invites, quality logging
-- Adds company slugs, no-poll realtime readiness, needs_human status, invite
-- records, and answer quality logs for company/super-admin dashboards.
-- ===========================================================================

create or replace function public.slugify(value text)
returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(value, 'company')), '[^a-z0-9]+', '-', 'g'));
$$;

alter table public.companies add column if not exists slug text;

with base as (
  select
    id,
    public.slugify(name) as base_slug,
    row_number() over (partition by public.slugify(name) order by created_at, id) as rn
  from public.companies
  where slug is null
)
update public.companies c
set slug = case when base.rn = 1 then base.base_slug else base.base_slug || '-' || base.rn::text end
from base
where c.id = base.id;

create unique index if not exists idx_companies_slug_unique on public.companies(slug);

do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.conversations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%ai_active%'
    and pg_get_constraintdef(oid) like '%human_active%'
    and pg_get_constraintdef(oid) like '%expired%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.conversations drop constraint %I', constraint_name);
  end if;

  alter table public.conversations
    add constraint conversations_status_check
    check (status in ('ai_active','needs_human','human_active','closed','expired'));
end$$;

create table if not exists public.agent_invites (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  email         text not null,
  role          text not null default 'agent' check (role in ('agent')),
  token_hash    text not null unique,
  invited_by    uuid references public.users(id) on delete set null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, email, revoked_at)
);
create index if not exists idx_agent_invites_company on public.agent_invites(company_id, created_at desc);
create index if not exists idx_agent_invites_email on public.agent_invites(lower(email));

drop trigger if exists trg_agent_invites_updated_at on public.agent_invites;
create trigger trg_agent_invites_updated_at before update on public.agent_invites
  for each row execute function public.set_updated_at();

create table if not exists public.answer_quality_logs (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  bot_id               uuid references public.bots(id) on delete set null,
  conversation_id      uuid references public.conversations(id) on delete cascade,
  visitor_message_id   uuid references public.messages(id) on delete set null,
  assistant_message_id uuid references public.messages(id) on delete set null,
  question             text not null,
  answer               text not null default '',
  provider             text,
  model                text,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  estimated_cost       numeric(12,8) not null default 0,
  latency_ms           integer,
  retrieved_chunks     jsonb not null default '[]'::jsonb,
  tools_called         text[] not null default '{}',
  source_types         text[] not null default '{}',
  retrieval_score      double precision,
  confidence_score     double precision,
  handoff_status       text not null default 'none'
                         check (handoff_status in ('none','suggested','needs_human','human_active')),
  failure_reason       text,
  metadata_json        jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index if not exists idx_quality_company on public.answer_quality_logs(company_id, created_at desc);
create index if not exists idx_quality_bot on public.answer_quality_logs(bot_id, created_at desc);
create index if not exists idx_quality_failure on public.answer_quality_logs(company_id, failure_reason);

do $$
declare t text;
begin
  foreach t in array array['agent_invites','answer_quality_logs'] loop
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
