-- ===========================================================================
-- Migration 0061 — Web push subscriptions + mobile embed identity secret
--
-- Two jobs, one migration, because both replace the native mobile SDK we are
-- no longer building.
--
-- 1. `push_subscriptions` — the dashboard PWA's push endpoints. A browser push
--    subscription belongs to a PERSON (the agent who granted permission on that
--    device) but must also be scoped to a COMPANY, because every fan-out in
--    this product is company-scoped and an agent can, in principle, be moved
--    between companies. The endpoint is globally unique — the push service
--    hands out one URL per browser install — so re-subscribing the same device
--    updates the row instead of accumulating duplicates.
--    `failed_count` exists so a device that is failing intermittently (a 500
--    from the push service, a network blip) is not deleted on the first error,
--    while a 404/410 "gone" response deletes it immediately.
--
-- 2. `bots.mobile_embed_secret_encrypted` — the per-bot HMAC key a host native
--    app uses to sign "this really is customer 123" when it opens the embedded
--    chat in a WebView. Stored encrypted at rest with ENCRYPTION_KEY, like
--    every other secret in this schema, so a leaked database dump cannot be
--    used to impersonate a customer. No existing column on `bots` was suitable:
--    `public_bot_id` is deliberately public and `appearance_json` is served to
--    anonymous browsers by /api/widget/config.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_count integer not null default 0
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_company on public.push_subscriptions(company_id, last_seen_at desc);

-- Why a separate log rather than reusing notification_delivery_logs: that table
-- is company-facing ("who did we tell and did it arrive"), keyed by the four
-- configured delivery channels. Push is per-DEVICE, is far chattier, and its
-- interesting failure is "this endpoint is gone, prune it" — a different
-- question with a different retention need.
create table if not exists public.push_delivery_log (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid references public.users(id) on delete set null,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  event_type      text not null,
  status          text not null default 'sent' check (status in ('sent','failed','pruned','skipped')),
  status_code     integer,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_push_delivery_log_company on public.push_delivery_log(company_id, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.push_delivery_log  enable row level security;

drop policy if exists push_subscriptions_super_admin_all on public.push_subscriptions;
create policy push_subscriptions_super_admin_all on public.push_subscriptions
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists push_subscriptions_select_members on public.push_subscriptions;
create policy push_subscriptions_select_members on public.push_subscriptions
  for select to authenticated using (company_id in (select public.user_company_ids()));

drop policy if exists push_delivery_log_super_admin_all on public.push_delivery_log;
create policy push_delivery_log_super_admin_all on public.push_delivery_log
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists push_delivery_log_select_members on public.push_delivery_log;
create policy push_delivery_log_select_members on public.push_delivery_log
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- --------------------------------------------------------------------------
-- Per-bot signing secret for the mobile embed identity handoff.
-- Null means "this bot has never been used from a native app"; the embed still
-- works, every visitor is simply anonymous until a secret is generated.
-- --------------------------------------------------------------------------
alter table public.bots add column if not exists mobile_embed_secret_encrypted text;
