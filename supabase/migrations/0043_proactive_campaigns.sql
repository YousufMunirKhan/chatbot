-- ===========================================================================
-- Migration 0043 — Proactive / outbound campaigns
-- Behaviour-triggered in-widget messages: show a targeted nudge after N seconds
-- on pages matching a URL pattern. Goes beyond the single static
-- appearance.proactiveMessage by supporting many rules with URL targeting.
-- (Broadcast-to-contacts over WhatsApp/email builds on the channel work.)
-- ===========================================================================

create table if not exists public.proactive_campaigns (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  bot_id        uuid references public.bots(id) on delete cascade,
  name          text not null,
  type          text not null default 'web_proactive' check (type in ('web_proactive')),
  status        text not null default 'active' check (status in ('active','paused','draft')),
  match_url     text,            -- substring/glob match against the page URL (null = all pages)
  delay_seconds integer not null default 8,
  message       text not null,
  auto_open     boolean not null default false,
  priority      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_proactive_campaigns_company on public.proactive_campaigns(company_id, status);
create index if not exists idx_proactive_campaigns_bot on public.proactive_campaigns(bot_id, status);

alter table public.proactive_campaigns enable row level security;

drop policy if exists proactive_campaigns_super_admin_all on public.proactive_campaigns;
create policy proactive_campaigns_super_admin_all on public.proactive_campaigns
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists proactive_campaigns_select_members on public.proactive_campaigns;
create policy proactive_campaigns_select_members on public.proactive_campaigns
  for select to authenticated using (company_id in (select public.user_company_ids()));
