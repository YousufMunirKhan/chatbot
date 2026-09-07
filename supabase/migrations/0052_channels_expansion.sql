-- ===========================================================================
-- Migration 0052 — Channel expansion (Telegram, Viber, LINE, TikTok, YouTube,
-- Facebook Messenger, Gmail) + feed-comment capture.
--
-- The platform already routes inbound messages through channel_identities →
-- bot → processInboundMessage. This migration widens the allowed channel keys
-- so the same pipeline serves every messaging surface, and adds a dedupe table
-- for public feed comments (Instagram/Facebook posts, TikTok, YouTube) which
-- webhooks re-deliver aggressively.
-- ===========================================================================

-- --- 1. Widen the channel vocabulary ---------------------------------------
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in (
    'web_chat','voice','whatsapp','instagram','facebook','email','phone','api',
    'telegram','viber','line','tiktok','youtube'
  ));

alter table public.channel_identities drop constraint if exists channel_identities_channel_check;
alter table public.channel_identities
  add constraint channel_identities_channel_check
  check (channel in (
    'whatsapp','instagram','facebook','email',
    'telegram','viber','line','tiktok','youtube'
  ));

-- --- 2. Feed comments -------------------------------------------------------
-- One row per public comment we have already reacted to. The unique index is
-- the dedupe guard: providers retry webhooks, and replying twice to the same
-- comment is publicly visible, so uniqueness is enforced in the database rather
-- than in application memory.
create table if not exists public.channel_comment_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  channel       text not null check (channel in ('instagram','facebook','tiktok','youtube')),
  external_id   text not null,              -- the account/page/channel that owns the post
  comment_id    text not null,              -- provider comment id
  post_id       text,
  author_id     text,
  text          text,
  replied       boolean not null default false,
  reply_kind    text check (reply_kind in ('public','private')),
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_channel_comment_events
  on public.channel_comment_events(channel, comment_id);
create index if not exists idx_channel_comment_events_company
  on public.channel_comment_events(company_id, created_at desc);

alter table public.channel_comment_events enable row level security;

drop policy if exists channel_comment_events_super_admin_all on public.channel_comment_events;
create policy channel_comment_events_super_admin_all on public.channel_comment_events
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists channel_comment_events_select_members on public.channel_comment_events;
create policy channel_comment_events_select_members on public.channel_comment_events
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --- 3. Per-identity display name ------------------------------------------
-- The Channels screen lists raw provider ids today ("102938475"). A label makes
-- a multi-page/multi-number account readable without another provider call.
alter table public.channel_identities add column if not exists display_name text;

-- --- 4. Inbound webhook dedupe ---------------------------------------------
-- Providers retry deliveries aggressively (Meta and Telegram both re-send on a
-- slow 200). The unique index makes "have we already answered this message?" a
-- single indexed insert rather than a scan of the message history.
create table if not exists public.channel_inbound_events (
  id          bigserial primary key,
  channel     text not null,
  external_id text not null,
  message_id  text not null,
  received_at timestamptz not null default now()
);
create unique index if not exists uq_channel_inbound_events
  on public.channel_inbound_events(channel, message_id);
create index if not exists idx_channel_inbound_events_received
  on public.channel_inbound_events(received_at);

alter table public.channel_inbound_events enable row level security;
-- Service-role only: this is webhook plumbing, never read by the dashboard.
drop policy if exists channel_inbound_events_super_admin_all on public.channel_inbound_events;
create policy channel_inbound_events_super_admin_all on public.channel_inbound_events
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
