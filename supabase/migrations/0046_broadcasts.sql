-- ===========================================================================
-- Migration 0046 — Outbound broadcasts to contacts
-- Scheduled WhatsApp/email campaigns sent to the lead list, dispatched by a cron
-- job through the company's connected channel (channel_identities). Distinct
-- from proactive_campaigns (those are in-widget web nudges).
-- ===========================================================================

create table if not exists public.broadcasts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp','email')),
  subject      text,
  message      text not null,
  audience     text not null default 'all_leads' check (audience in ('all_leads')),
  schedule_at  timestamptz,
  status       text not null default 'scheduled' check (status in ('scheduled','sending','sent','failed')),
  sent_count   integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists idx_broadcasts_company on public.broadcasts(company_id, created_at desc);
create index if not exists idx_broadcasts_due on public.broadcasts(status, schedule_at);

alter table public.broadcasts enable row level security;

drop policy if exists broadcasts_super_admin_all on public.broadcasts;
create policy broadcasts_super_admin_all on public.broadcasts
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists broadcasts_select_members on public.broadcasts;
create policy broadcasts_select_members on public.broadcasts
  for select to authenticated using (company_id in (select public.user_company_ids()));
