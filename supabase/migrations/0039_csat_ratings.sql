-- ===========================================================================
-- Migration 0039 — Customer Satisfaction (CSAT)
-- Customer-facing post-conversation rating (1–5) + optional comment. Distinct
-- from the INTERNAL answer_quality_* tables (those are staff-only QA signals):
-- this is the metric the end-customer reports, surfaced in the inbox and the
-- company analytics. One rating per conversation (re-submit updates in place).
-- ===========================================================================

create table if not exists public.conversation_ratings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  bot_id          uuid references public.bots(id) on delete set null,
  visitor_id      text,
  channel         text not null default 'web_chat',
  rating          smallint not null check (rating between 1 and 5),
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One satisfaction score per conversation; the widget upserts on this key.
create unique index if not exists uq_conversation_ratings_conversation
  on public.conversation_ratings(conversation_id);
create index if not exists idx_conversation_ratings_company_created
  on public.conversation_ratings(company_id, created_at desc);

-- Denormalised onto conversations so the inbox list + analytics can read the
-- score without a join (and filter "rated/unrated" cheaply).
alter table public.conversations
  add column if not exists csat_rating   smallint check (csat_rating between 1 and 5),
  add column if not exists csat_comment  text,
  add column if not exists csat_rated_at timestamptz;

alter table public.conversation_ratings enable row level security;

drop policy if exists conversation_ratings_super_admin_all on public.conversation_ratings;
create policy conversation_ratings_super_admin_all on public.conversation_ratings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists conversation_ratings_select_members on public.conversation_ratings;
create policy conversation_ratings_select_members on public.conversation_ratings
  for select to authenticated using (company_id in (select public.user_company_ids()));
