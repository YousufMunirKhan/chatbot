-- ===========================================================================
-- Migration 0037 - Staff-only Help Desk chat surface
-- Controls where internal Help Desk chat may appear inside customer apps.
-- ===========================================================================

create table if not exists public.helpdesk_chat_settings (
  company_id       uuid primary key references public.companies(id) on delete cascade,
  enabled          boolean not null default true,
  show_mode        text not null default 'floating'
                    check (show_mode in ('floating','embedded','hidden')),
  allowed_roles    text[] not null default array['admin','manager','staff'],
  allowed_routes   text[] not null default array['dashboard','inventory/*','purchase/*','reports/*','customers/*','orders/*'],
  blocked_routes   text[] not null default array['login','payment','checkout','customer-facing/*','customer-display/*'],
  auto_open        boolean not null default false,
  position         text not null default 'right'
                    check (position in ('left','right')),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_helpdesk_chat_settings_updated_at on public.helpdesk_chat_settings;
create trigger trg_helpdesk_chat_settings_updated_at before update on public.helpdesk_chat_settings
  for each row execute function public.set_updated_at();

alter table public.helpdesk_chat_settings enable row level security;

drop policy if exists helpdesk_chat_settings_super_admin_all on public.helpdesk_chat_settings;
create policy helpdesk_chat_settings_super_admin_all on public.helpdesk_chat_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists helpdesk_chat_settings_select_members on public.helpdesk_chat_settings;
create policy helpdesk_chat_settings_select_members on public.helpdesk_chat_settings
  for select to authenticated using (company_id in (select public.user_company_ids()));
