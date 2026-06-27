-- ===========================================================================
-- Migration 0004 — Subscriptions (introduced for Module 4 super-admin onboarding;
-- Stripe integration is layered on in Module 19).
-- One subscription per company: plan, status, super-admin overrides
-- (free_until, message/agent/bot/integration limits).
-- ===========================================================================

create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null unique references public.companies(id) on delete cascade,
  plan                   text not null default 'free_trial'
                           check (plan in ('free_trial','starter','growth','pro','custom')),
  status                 text not null default 'trialing'
                           check (status in ('trialing','active','past_due','canceled','suspended')),
  free_until             date,
  trial_ends_at          timestamptz,
  message_limit          integer,
  agent_limit            integer,
  bot_limit              integer,
  integration_limit      integer,
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_subscriptions_company on public.subscriptions(company_id);

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

-- Super admins: full access.
drop policy if exists subscriptions_super_admin_all on public.subscriptions;
create policy subscriptions_super_admin_all on public.subscriptions
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Company members: read their own company's subscription.
drop policy if exists subscriptions_select_members on public.subscriptions;
create policy subscriptions_select_members on public.subscriptions
  for select to authenticated
  using (company_id in (select public.user_company_ids()));
