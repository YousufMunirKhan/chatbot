-- ===========================================================================
-- Migration 0016 - Platform runtime settings + Smart Quick Actions
-- DB-managed AI/email settings and contextual widget quick actions.
-- ===========================================================================

create table if not exists public.bot_quick_actions (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  bot_id                  uuid references public.bots(id) on delete cascade,
  label                   text not null,
  description             text,
  action_type             text not null
                            check (action_type in (
                              'send_message',
                              'direct_answer',
                              'lead_form',
                              'appointment_form',
                              'external_link',
                              'product_link',
                              'whatsapp',
                              'phone_call',
                              'request_human',
                              'tool_action'
                            )),
  action_config_json      jsonb not null default '{}'::jsonb,
  form_schema_json        jsonb not null default '[]'::jsonb,
  contexts                text[] not null default '{}',
  keyword_triggers        text[] not null default '{}',
  page_url_patterns       text[] not null default '{}',
  required_capabilities   text[] not null default '{}',
  business_hours_mode     text not null default 'any'
                            check (business_hours_mode in ('any','during_hours','after_hours')),
  conversation_statuses   text[] not null default '{}',
  priority                integer not null default 100,
  is_active               boolean not null default true,
  starts_new_message      boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_bot_quick_actions_company on public.bot_quick_actions(company_id, is_active, priority);
create index if not exists idx_bot_quick_actions_bot on public.bot_quick_actions(bot_id, is_active, priority);

drop trigger if exists trg_bot_quick_actions_updated_at on public.bot_quick_actions;
create trigger trg_bot_quick_actions_updated_at before update on public.bot_quick_actions
  for each row execute function public.set_updated_at();

create table if not exists public.quick_action_clicks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  bot_id           uuid references public.bots(id) on delete set null,
  quick_action_id  uuid references public.bot_quick_actions(id) on delete set null,
  conversation_id  uuid references public.conversations(id) on delete set null,
  visitor_id       text,
  action_type      text,
  completed_at     timestamptz,
  metadata_json    jsonb not null default '{}'::jsonb,
  clicked_at       timestamptz not null default now()
);
create index if not exists idx_quick_action_clicks_company on public.quick_action_clicks(company_id, clicked_at desc);

do $$
declare t text;
begin
  foreach t in array array['bot_quick_actions','quick_action_clicks'] loop
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
