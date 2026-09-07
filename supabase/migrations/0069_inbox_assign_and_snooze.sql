-- ===========================================================================
-- Migration 0069 — Inbox assignment, snooze, and queue filters
--
-- Three gaps on one screen, and they share a WHERE clause, which is why they
-- share a migration.
--
--  1. ASSIGNMENT was implicit: replying set `assigned_agent_id` to whoever
--     replied and nothing else was ever recorded. There was no way to hand a
--     conversation to a colleague, and no way to answer "who put this on my
--     queue?". `assigned_at` / `assigned_by` answer that without a join.
--
--  2. FILTERS by channel, assignee, tag and date range compose with the six
--     existing queues, so every one of them is now a filtered scan rather than
--     the plain `company_id, last_message_at desc` walk the single inbox index
--     was built for. The indexes below keep the filtered queues on an index.
--
--  3. SNOOZE puts a conversation aside until a chosen time. `snoozed_until` is
--     the whole feature: a row counts as snoozed while that timestamp is in the
--     FUTURE, so a conversation returns to its queue the moment it is due,
--     whether or not the sweep in /api/cron/snooze has run yet. The sweep only
--     clears the expired timestamps (and the "who snoozed it" trail); it is a
--     tidy-up, never the thing that makes a conversation reappear. That matters
--     because a cron job that stops running is a normal Tuesday, and a
--     conversation that never comes back is a customer nobody answers.
-- ===========================================================================

alter table public.conversations
  add column if not exists assigned_at   timestamptz,
  add column if not exists assigned_by   uuid references public.users(id) on delete set null,
  add column if not exists snoozed_until timestamptz,
  add column if not exists snoozed_by    uuid references public.users(id) on delete set null;

comment on column public.conversations.snoozed_until is
  'While this is in the future the conversation is hidden from the open queues. Cleared by /api/cron/snooze once due; the queues do not depend on that sweep having run.';

-- ---------------------------------------------------------------------------
-- Indexes for the filters.
--
-- `idx_conversations_inbox` (company_id, last_message_at desc) still serves an
-- unfiltered queue. These three cover the filtered ones: each leads with
-- company_id, so it is only ever read within one tenant, and carries
-- last_message_at so the queue's sort order comes off the index rather than out
-- of a sort node.
--
-- Priority gets one too. `urgent` was already a queue and had no index of its
-- own, so it was a scan of the whole company before this migration and would
-- have stayed one after it.
-- ---------------------------------------------------------------------------
create index if not exists idx_conversations_company_assignee
  on public.conversations (company_id, assigned_agent_id, last_message_at desc);

create index if not exists idx_conversations_company_channel
  on public.conversations (company_id, channel, last_message_at desc);

create index if not exists idx_conversations_company_priority
  on public.conversations (company_id, priority, last_message_at desc);

-- `tags` is a text[] and the filter is a containment test (`tags @> '{vip}'`),
-- which btree cannot answer at all.
create index if not exists idx_conversations_tags
  on public.conversations using gin (tags);

-- The snooze sweep asks one question across every tenant — "which snoozes are
-- due?" — so this one is deliberately NOT company-scoped. Partial, because the
-- overwhelming majority of rows are never snoozed and do not belong in it.
create index if not exists idx_conversations_snoozed_due
  on public.conversations (snoozed_until)
  where snoozed_until is not null;

-- ---------------------------------------------------------------------------
-- The queue counts, re-cut for snooze.
--
-- `inbox_queue_counts` came from migration 0062, where it replaced six
-- `head: true` count requests with one pass so the rail costs one round trip
-- instead of six. It gains a seventh number here and its three open queues stop
-- counting snoozed conversations — otherwise "Waiting for you: 12" would keep
-- promising work that the list beneath it no longer shows.
--
-- Dropped and recreated rather than `create or replace`d: a function's return
-- type cannot be changed in place. The ARGUMENT list is deliberately unchanged,
-- so there is never a moment where two overloads exist and a call by named
-- argument becomes ambiguous.
--
-- The filters here are still the ones in `queueQuery()` in
-- src/modules/company/inbox-data.ts and still have to stay in step with it,
-- which is why they are listed in the same order as INBOX_QUEUES. The
-- channel/assignee/tag/date filters are NOT applied here on purpose: the rail
-- reports what is in each queue company-wide, exactly as it already ignored the
-- search box, so an agent narrowing the list can still see how much work the
-- filter is hiding.
-- ---------------------------------------------------------------------------
drop function if exists public.inbox_queue_counts(uuid, uuid, uuid[]);

create function public.inbox_queue_counts(
  p_company_id uuid,
  p_user_id uuid default null,
  p_conversation_ids uuid[] default null
)
returns table (
  waiting integer,
  mine integer,
  everything integer,
  urgent integer,
  poor integer,
  closed integer,
  snoozed integer
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      c.status,
      c.priority,
      c.csat_rating,
      c.assigned_agent_id,
      (c.snoozed_until is not null and c.snoozed_until > now()) as is_snoozed
    from public.conversations c
    where c.company_id = p_company_id
      and (p_conversation_ids is null or c.id = any(p_conversation_ids))
  )
  select
    count(*) filter (where status = 'needs_human' and not is_snoozed)::integer as waiting,
    count(*) filter (
      where assigned_agent_id = p_user_id
        and status not in ('closed', 'expired')
        and not is_snoozed
    )::integer as mine,
    count(*)::integer as everything,
    count(*) filter (
      where priority = 'urgent'
        and status not in ('closed', 'expired')
        and not is_snoozed
    )::integer as urgent,
    count(*) filter (where csat_rating is not null and csat_rating <= 2)::integer as poor,
    count(*) filter (where status = 'closed')::integer as closed,
    count(*) filter (where is_snoozed)::integer as snoozed
  from scoped;
$$;

revoke execute on function public.inbox_queue_counts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.inbox_queue_counts(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- What the filter bar and the assign control need to offer, in one round trip.
--
-- Two lists that have nothing to do with each other are fetched together
-- because of what a round trip costs here (0062 measured ~230 ms each, whatever
-- it asks for). Separately they would be two, and the inbox page is held to a
-- round-trip budget by scripts/test-query-counts.mjs.
--
-- The tag list is the tags actually in use by this company, so the filter can
-- suggest them; the reader treats a missing function as a soft failure and
-- falls back to the member query alone, which leaves the tag box a plain text
-- input rather than breaking the page.
-- ---------------------------------------------------------------------------
create or replace function public.inbox_filter_options(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'user_id', cu.user_id,
                 'name', coalesce(nullif(u.full_name, ''), u.email),
                 'role', cu.role
               )
               order by coalesce(nullif(u.full_name, ''), u.email)
             )
      from public.company_users cu
      join public.users u on u.id = cu.user_id
      where cu.company_id = p_company_id
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(t.tag order by t.tag)
      from (
        select distinct unnest(c.tags) as tag
        from public.conversations c
        where c.company_id = p_company_id
        limit 200
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.inbox_filter_options(uuid) from public, anon, authenticated;
grant  execute on function public.inbox_filter_options(uuid) to service_role;
