-- ===========================================================================
-- Migration 0030 - Notification delivery settings and logs
-- ===========================================================================

create table if not exists public.company_notification_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  notifications_enabled boolean not null default true,
  email_enabled boolean not null default false,
  email_sender_mode text not null default 'platform'
    check (email_sender_mode in ('platform','company_smtp')),
  email_to text[] not null default '{}'::text[],
  email_cc text[] not null default '{}'::text[],
  email_bcc text[] not null default '{}'::text[],
  email_reply_to text,
  smtp_host text,
  smtp_port integer,
  smtp_username text,
  smtp_password_encrypted text,
  smtp_secure boolean not null default true,
  smtp_from_email text,
  smtp_from_name text,
  whatsapp_enabled boolean not null default false,
  whatsapp_recipients text[] not null default '{}'::text[],
  slack_enabled boolean not null default false,
  slack_webhook_encrypted text,
  webhook_enabled boolean not null default false,
  generic_webhook_url_encrypted text,
  generic_webhook_secret_encrypted text,
  event_rules_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('email','whatsapp','slack','webhook')),
  recipient text,
  status text not null check (status in ('sent','failed','skipped')),
  error_message text,
  related_lead_id uuid references public.leads(id) on delete set null,
  related_appointment_id uuid references public.appointments(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_delivery_logs_company
  on public.notification_delivery_logs(company_id, created_at desc);
create index if not exists idx_notification_delivery_logs_status
  on public.notification_delivery_logs(status, created_at desc);

create or replace function public.touch_company_notification_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_company_notification_settings_touch
  on public.company_notification_settings;
create trigger trg_company_notification_settings_touch
  before update on public.company_notification_settings
  for each row execute function public.touch_company_notification_settings();

alter table public.company_notification_settings enable row level security;
alter table public.notification_delivery_logs enable row level security;

drop policy if exists company_notification_settings_super_admin_all
  on public.company_notification_settings;
create policy company_notification_settings_super_admin_all
  on public.company_notification_settings
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists company_notification_settings_select_members
  on public.company_notification_settings;
create policy company_notification_settings_select_members
  on public.company_notification_settings
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

drop policy if exists company_notification_settings_admin_manage
  on public.company_notification_settings;
create policy company_notification_settings_admin_manage
  on public.company_notification_settings
  for all to authenticated
  using (
    company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and role = 'company_admin'
    )
  )
  with check (
    company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and role = 'company_admin'
    )
  );

drop policy if exists notification_delivery_logs_super_admin_all
  on public.notification_delivery_logs;
create policy notification_delivery_logs_super_admin_all
  on public.notification_delivery_logs
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists notification_delivery_logs_select_members
  on public.notification_delivery_logs;
create policy notification_delivery_logs_select_members
  on public.notification_delivery_logs
  for select to authenticated
  using (company_id in (select public.user_company_ids()));
