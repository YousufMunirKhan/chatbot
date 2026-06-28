-- ===========================================================================
-- Migration 0031 - Monthly reply grants and company-owned WhatsApp senders
-- ===========================================================================

create table if not exists public.company_reply_grants (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  reply_count     integer not null check (reply_count > 0),
  reason          text not null default 'Manual allowance adjustment',
  grant_type      text not null default 'manual'
                    check (grant_type in ('manual','goodwill','paid_extra','support_adjustment')),
  expires_at      timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_company_reply_grants_company
  on public.company_reply_grants(company_id, expires_at desc, created_at desc);

alter table public.company_reply_grants enable row level security;

drop policy if exists company_reply_grants_super_admin_all on public.company_reply_grants;
create policy company_reply_grants_super_admin_all
  on public.company_reply_grants
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists company_reply_grants_select_members on public.company_reply_grants;
create policy company_reply_grants_select_members
  on public.company_reply_grants
  for select to authenticated
  using (company_id in (select public.user_company_ids()));

alter table public.company_notification_settings
  add column if not exists whatsapp_sender_mode text not null default 'company'
    check (whatsapp_sender_mode in ('company','platform_managed')),
  add column if not exists whatsapp_provider text not null default 'disabled'
    check (whatsapp_provider in ('disabled','meta_cloud','twilio')),
  add column if not exists meta_phone_number_id text,
  add column if not exists meta_access_token_encrypted text,
  add column if not exists meta_template_name text,
  add column if not exists meta_template_language text not null default 'en_GB',
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token_encrypted text,
  add column if not exists twilio_whatsapp_from text;
