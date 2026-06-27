-- ===========================================================================
-- Migration 0007 — Leads, Appointments, Notifications (Modules 12, 13, 24)
-- ===========================================================================

create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  bot_id          uuid references public.bots(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  name            text,
  email           text,
  phone           text,
  enquiry_type    text,
  message         text,
  source_page     text,
  source          text not null default 'chat',
  status          text not null default 'new'
                    check (status in ('new','contacted','qualified','converted','closed')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_leads_company on public.leads(company_id, created_at desc);

create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  bot_id            uuid references public.bots(id) on delete set null,
  conversation_id   uuid references public.conversations(id) on delete set null,
  customer_name     text,
  customer_phone    text,
  customer_email    text,
  service_type      text,
  preferred_date    date,
  preferred_time    text,
  notes             text,
  status            text not null default 'requested'
                      check (status in ('requested','confirmed','cancelled','completed','no_show')),
  assigned_agent_id uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_appointments_company on public.appointments(company_id, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  data_json   jsonb not null default '{}'::jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_company on public.notifications(company_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['leads','appointments','notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())', t || '_super_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_members', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id in (select public.user_company_ids()))', t || '_select_members', t);
  end loop;
end$$;
