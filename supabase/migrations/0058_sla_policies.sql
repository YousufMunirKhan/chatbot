-- ===========================================================================
-- Migration 0058 — SLA policies and per-conversation SLA tracking
--
-- The platform had a single `sla_response_minutes` setting. Support teams need
-- more than one clock: a different first-response target per priority, per
-- channel and per group, a resolution target as well as a response target,
-- targets that only tick during business hours, and an escalation when a clock
-- is about to run out.
--
-- Due times are computed once, when the clock starts, and stored. Finding
-- breaches is then an index scan over "due before now and not yet met" rather
-- than recomputing business-hours arithmetic for every open conversation on
-- every cron tick.
-- ===========================================================================

create table if not exists public.sla_policies (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  name                   text not null,
  -- Narrowing filters; null means "any". The most specific active policy wins.
  applies_priority       text check (applies_priority in ('low','normal','high','urgent')),
  applies_channel        text,
  applies_group_id       uuid,
  first_response_minutes integer not null default 15 check (first_response_minutes > 0),
  resolution_minutes     integer check (resolution_minutes is null or resolution_minutes > 0),
  -- When true the clock pauses outside the company's opening hours.
  business_hours_only    boolean not null default false,
  -- Warn this many minutes before the deadline; null disables the warning.
  escalate_before_minutes integer,
  escalate_to_user_id    uuid references public.users(id) on delete set null,
  is_active              boolean not null default true,
  priority               integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_sla_policies_company
  on public.sla_policies(company_id, priority desc) where is_active;

-- The running clock for one conversation.
create table if not exists public.sla_states (
  conversation_id        uuid primary key references public.conversations(id) on delete cascade,
  company_id             uuid not null references public.companies(id) on delete cascade,
  policy_id              uuid references public.sla_policies(id) on delete set null,
  started_at             timestamptz not null default now(),
  first_response_due_at  timestamptz,
  resolution_due_at      timestamptz,
  first_response_at      timestamptz,
  resolved_at            timestamptz,
  first_response_breached boolean not null default false,
  resolution_breached    boolean not null default false,
  warned_at              timestamptz,
  escalated_at           timestamptz,
  updated_at             timestamptz not null default now()
);
-- The breach sweep's access path: "open clocks whose deadline has passed".
create index if not exists idx_sla_states_response_due
  on public.sla_states(first_response_due_at)
  where first_response_at is null and first_response_breached = false;
create index if not exists idx_sla_states_resolution_due
  on public.sla_states(resolution_due_at)
  where resolved_at is null and resolution_breached = false;
create index if not exists idx_sla_states_company on public.sla_states(company_id, started_at desc);

-- An audit trail so a manager can see what breached and when.
create table if not exists public.sla_events (
  id              bigserial primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  policy_id       uuid references public.sla_policies(id) on delete set null,
  event           text not null check (event in ('started','responded','resolved','warned','breached_response','breached_resolution','escalated')),
  minutes         integer,
  created_at      timestamptz not null default now()
);
create index if not exists idx_sla_events_company on public.sla_events(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['sla_policies','sla_states','sla_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))',
      t || '_select_members', t);
  end loop;
end $$;
