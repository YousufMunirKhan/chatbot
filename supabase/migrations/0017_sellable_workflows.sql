-- ===========================================================================
-- Migration 0017 - Sellable workflow polish
-- Agent invite acceptance, Google Calendar foundation, quality feedback,
-- platform setting audit events, and WebSocket configuration placeholder.
-- ===========================================================================

alter table public.agent_invites add column if not exists full_name text;
alter table public.agent_invites add column if not exists accepted_user_id uuid references public.users(id) on delete set null;
alter table public.agent_invites add column if not exists last_sent_at timestamptz;

create table if not exists public.answer_quality_feedback (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  quality_log_id      uuid not null references public.answer_quality_logs(id) on delete cascade,
  status              text not null default 'open'
                        check (status in ('open','fixed','ignored')),
  rating              text check (rating in ('good','bad','missing_info','wrong_answer','too_slow','needs_human')),
  correction_text     text,
  created_document_id uuid references public.documents(id) on delete set null,
  created_by          uuid references public.users(id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_quality_feedback_company on public.answer_quality_feedback(company_id, created_at desc);
create unique index if not exists idx_quality_feedback_log_unique on public.answer_quality_feedback(quality_log_id);

create table if not exists public.platform_setting_events (
  id             uuid primary key default gen_random_uuid(),
  setting_key    text,
  event_type     text not null,
  actor_user_id  uuid references public.users(id) on delete set null,
  metadata_json  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_platform_setting_events_created on public.platform_setting_events(created_at desc);

create table if not exists public.google_calendar_events (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  appointment_id       uuid references public.appointments(id) on delete cascade,
  integration_id       uuid references public.integration_accounts(id) on delete set null,
  google_event_id      text,
  status               text not null default 'pending'
                         check (status in ('pending','created','failed')),
  error_message        text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_google_calendar_events_company on public.google_calendar_events(company_id, created_at desc);

insert into public.platform_settings (key, value_json, is_secret)
values
  ('realtime.provider', '"supabase"', false),
  ('realtime.custom_ws_url', 'null', false)
on conflict (key) do nothing;

do $$
declare t text;
begin
  foreach t in array array['answer_quality_feedback','platform_setting_events','google_calendar_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin())',
      t || '_super_admin_all',
      t
    );
  end loop;
end$$;

drop policy if exists answer_quality_feedback_select_members on public.answer_quality_feedback;
create policy answer_quality_feedback_select_members on public.answer_quality_feedback
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists google_calendar_events_select_members on public.google_calendar_events;
create policy google_calendar_events_select_members on public.google_calendar_events
  for select to authenticated using (company_id in (select public.user_company_ids()));
