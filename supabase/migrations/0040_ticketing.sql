-- ===========================================================================
-- Migration 0040 — Ticketing depth for the inbox
--   * canned_responses: reusable saved replies / macros per company
--   * conversation viewing markers: lightweight collision detection so two
--     agents don't unknowingly work the same chat
--   * RLS top-up for conversation_internal_notes (table added in 0018)
-- priority + tags + internal_notes already exist (migration 0018); this only
-- adds what's missing to wire a real agent workspace.
-- ===========================================================================

create table if not exists public.canned_responses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  title       text not null,
  body        text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_canned_responses_company on public.canned_responses(company_id, title);

alter table public.canned_responses enable row level security;

drop policy if exists canned_responses_super_admin_all on public.canned_responses;
create policy canned_responses_super_admin_all on public.canned_responses
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists canned_responses_select_members on public.canned_responses;
create policy canned_responses_select_members on public.canned_responses
  for select to authenticated using (company_id in (select public.user_company_ids()));

-- Collision detection: who is currently looking at a conversation. Agents ping
-- this on open / periodically; the inbox warns when someone else is active.
alter table public.conversations
  add column if not exists viewing_user_id uuid references public.users(id) on delete set null,
  add column if not exists viewing_at      timestamptz;

-- conversation_internal_notes (0018) shipped without RLS policies; add them so
-- members can read their own company's notes under RLS as well as the service path.
alter table public.conversation_internal_notes enable row level security;

drop policy if exists conversation_internal_notes_super_admin_all on public.conversation_internal_notes;
create policy conversation_internal_notes_super_admin_all on public.conversation_internal_notes
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists conversation_internal_notes_select_members on public.conversation_internal_notes;
create policy conversation_internal_notes_select_members on public.conversation_internal_notes
  for select to authenticated using (company_id in (select public.user_company_ids()));
