-- ===========================================================================
-- Migration 0044 — Channel identities (Instagram / Email inbound) + email channel
-- A generic mapping from an inbound channel address (IG page id, inbound email
-- address, etc.) to the owning company + bot, so webhooks can route messages.
-- Also adds 'email' to the conversations.channel check (web/whatsapp/ig/fb
-- were already allowed).
-- ===========================================================================

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('web_chat','voice','whatsapp','instagram','facebook','email','phone','api'));

create table if not exists public.channel_identities (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  bot_id           uuid references public.bots(id) on delete set null,
  channel          text not null check (channel in ('whatsapp','instagram','facebook','email')),
  external_id      text not null,        -- IG page id / inbound email address / etc.
  secret_encrypted text,                 -- page/send token (encrypted via lib/crypto)
  settings_json    jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index if not exists uq_channel_identities_channel_external
  on public.channel_identities(channel, external_id);
create index if not exists idx_channel_identities_company on public.channel_identities(company_id, channel);

alter table public.channel_identities enable row level security;

drop policy if exists channel_identities_super_admin_all on public.channel_identities;
create policy channel_identities_super_admin_all on public.channel_identities
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists channel_identities_select_members on public.channel_identities;
create policy channel_identities_select_members on public.channel_identities
  for select to authenticated using (company_id in (select public.user_company_ids()));
