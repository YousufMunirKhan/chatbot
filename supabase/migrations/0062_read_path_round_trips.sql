-- ===========================================================================
-- Migration 0062 — Read-path round-trip collapse
--
-- WHY: the app server and this database are far apart. Measured on production,
-- a single round trip costs ~230 ms NO MATTER WHAT IT ASKS — `select 1` on an
-- already-warm connection took 229 ms, and ten of them took 2289 ms. Network
-- RTT to the Supabase edge is 0.95 ms, so this is not the network and it is not
-- the queries; it is the number of times the app speaks to the database.
--
-- That inverts the usual advice. Six cheap indexed counts are SIX times worse
-- than one sequential scan that answers all six, and the inbox's "one small
-- indexed lookup per row" was costing 25 × 230 ms = 5.75 s of the page.
--
-- Each function below replaces a group of queries the app was already making,
-- with identical filters. Every one takes `p_company_id` and filters on it in
-- every branch: tenant isolation is unchanged, and the caller passes the
-- SESSION user's own company id exactly as the TypeScript readers did.
--
-- All are `stable` (no writes) and `security definer` with a pinned
-- `search_path`. Callers treat a missing function as a soft failure and fall
-- back to the old query set, so an environment that has not run this migration
-- keeps working — slowly.
--
-- EXECUTE IS DELIBERATELY NOT GRANTED TO `authenticated`. These take a company
-- id as an argument and, being `security definer`, would answer for ANY company
-- id given to them — a signed-in user of tenant A could POST
-- /rest/v1/rpc/inbox_queue_counts with tenant B's uuid and read their numbers.
-- The only callers are server-side readers using the service-role client, which
-- pass the SESSION user's own company id, so execute is revoked from `public`
-- (Postgres grants it by default) and from `anon`/`authenticated` (Supabase's
-- default privileges grant it to them), and given to `service_role` alone.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Newest message per conversation, for the inbox queue's preview column.
--
-- Replaces one indexed single-row lookup PER ROW (25 per page). The reason that
-- N+1 was written deliberately is worth answering rather than ignoring: a plain
-- `where conversation_id in (...) order by created_at desc limit N` cannot be
-- trusted, because one busy thread can occupy the whole row budget and leave
-- every other row in the page blank.
--
-- `distinct on (conversation_id)` removes the budget entirely. Postgres returns
-- exactly one row per conversation — never more, so no thread can crowd out
-- another — and the sort matches idx_messages_conversation_created_desc
-- (conversation_id, created_at desc), so it is the same index the 25 lookups
-- were using, walked once.
-- ---------------------------------------------------------------------------
create or replace function public.inbox_last_messages(
  p_company_id uuid,
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  sender_type text,
  content_text text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id,
    m.sender_type,
    m.content_text,
    m.created_at
  from public.messages m
  where m.company_id = p_company_id
    and m.conversation_id = any(p_conversation_ids)
  order by m.conversation_id, m.created_at desc, m.id desc;
$$;

revoke execute on function public.inbox_last_messages(uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.inbox_last_messages(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. All six inbox queue counts in one pass.
--
-- Replaces six `head: true, count: exact` requests. The filters are copied from
-- `queueQuery()` in src/modules/company/inbox-data.ts and must stay in step
-- with it, which is why they are listed in the same order as INBOX_QUEUES.
--
-- `p_user_id` null means "no signed-in user", and `assigned_agent_id = null` is
-- never true, so `mine` is 0 — the same "match nothing rather than match
-- everyone" behaviour the TypeScript sentinel uuid produced.
--
-- `p_conversation_ids` null means "no search filter"; a non-null array narrows
-- every count to the search result, so the rail can never disagree with the
-- list beneath it.
-- ---------------------------------------------------------------------------
create or replace function public.inbox_queue_counts(
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
  closed integer
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select c.status, c.priority, c.csat_rating, c.assigned_agent_id
    from public.conversations c
    where c.company_id = p_company_id
      and (p_conversation_ids is null or c.id = any(p_conversation_ids))
  )
  select
    count(*) filter (where status = 'needs_human')::integer as waiting,
    count(*) filter (
      where assigned_agent_id = p_user_id and status not in ('closed', 'expired')
    )::integer as mine,
    count(*)::integer as everything,
    count(*) filter (
      where priority = 'urgent' and status not in ('closed', 'expired')
    )::integer as urgent,
    count(*) filter (where csat_rating is not null and csat_rating <= 2)::integer as poor,
    count(*) filter (where status = 'closed')::integer as closed
  from scoped;
$$;

revoke execute on function public.inbox_queue_counts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant  execute on function public.inbox_queue_counts(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Every number on the company home page, in one pass.
--
-- Replaces thirteen `head: true` counts plus the CSAT rating scan. The
-- conversations CTE is materialised once and reused by six of the numbers
-- instead of being counted six times over the wire.
--
-- Windows are half-open [from, to) exactly as `countCreatedBetween()` had them:
-- current is `>= p_current_from`, previous is `>= p_previous_from` AND
-- `< p_current_from`.
-- ---------------------------------------------------------------------------
create or replace function public.company_dashboard_counts(
  p_company_id uuid,
  p_current_from timestamptz,
  p_previous_from timestamptz
)
returns table (
  needs_reply integer,
  open_chats integer,
  chats_started_current integer,
  chats_started_previous integer,
  ai_answered_current integer,
  ai_answered_previous integer,
  leads_current integer,
  leads_previous integer,
  appointments_current integer,
  appointments_previous integer,
  chat_orders_current integer,
  chat_orders_previous integer,
  uncontacted_enquiries integer,
  overdue_replies integer,
  failed_automations integer,
  csat_responses integer,
  csat_average numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with convo as (
    select c.status, c.started_at, c.first_agent_reply_at, c.csat_rating, c.csat_rated_at
    from public.conversations c
    where c.company_id = p_company_id
  )
  select
    (select count(*) from convo where status in ('needs_human', 'human_active'))::integer,
    (select count(*) from convo where status not in ('closed', 'expired'))::integer,
    (select count(*) from convo where started_at >= p_current_from)::integer,
    (select count(*) from convo
      where started_at >= p_previous_from and started_at < p_current_from)::integer,
    (select count(*) from convo
      where started_at >= p_current_from
        and first_agent_reply_at is null
        and status not in ('needs_human', 'human_active'))::integer,
    (select count(*) from convo
      where started_at >= p_previous_from and started_at < p_current_from
        and first_agent_reply_at is null
        and status not in ('needs_human', 'human_active'))::integer,
    (select count(*) from public.leads
      where company_id = p_company_id and created_at >= p_current_from)::integer,
    (select count(*) from public.leads
      where company_id = p_company_id
        and created_at >= p_previous_from and created_at < p_current_from)::integer,
    (select count(*) from public.appointments
      where company_id = p_company_id and created_at >= p_current_from)::integer,
    (select count(*) from public.appointments
      where company_id = p_company_id
        and created_at >= p_previous_from and created_at < p_current_from)::integer,
    (select count(*) from public.chat_orders
      where company_id = p_company_id and created_at >= p_current_from)::integer,
    (select count(*) from public.chat_orders
      where company_id = p_company_id
        and created_at >= p_previous_from and created_at < p_current_from)::integer,
    (select count(*) from public.leads
      where company_id = p_company_id and status = 'new')::integer,
    (select count(*) from public.sla_states
      where company_id = p_company_id
        and first_response_breached
        and first_response_at is null
        and resolved_at is null)::integer,
    (select count(*) from public.automation_runs
      where company_id = p_company_id
        and status = 'failed'
        and created_at >= p_current_from)::integer,
    (select count(*) from convo
      where csat_rating is not null and csat_rated_at >= p_current_from)::integer,
    (select avg(csat_rating) from convo
      where csat_rating is not null and csat_rated_at >= p_current_from);
$$;

revoke execute on function public.company_dashboard_counts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.company_dashboard_counts(uuid, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The four synced-catalogue counts the setup checklist reads.
-- ---------------------------------------------------------------------------
create or replace function public.company_catalog_counts(p_company_id uuid)
returns table (
  products integer,
  orders integer,
  customers integer,
  menu_items integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.synced_products where company_id = p_company_id)::integer,
    (select count(*) from public.synced_orders where company_id = p_company_id)::integer,
    (select count(*) from public.synced_customers where company_id = p_company_id)::integer,
    (select count(*) from public.restaurant_menu_items where company_id = p_company_id)::integer;
$$;

revoke execute on function public.company_catalog_counts(uuid) from public, anon, authenticated;
grant  execute on function public.company_catalog_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The six business-memory reads the home page, the setup checklist and the
--    Business Data page all make together.
--
-- `to_jsonb(t)` rather than a column list on purpose: the TypeScript reader
-- does `select *` on four of these tables, so naming columns here would mean a
-- new column silently stops reaching the assistant's prompt. Ordering and the
-- `is_active` / `location_id is null` filters are copied from the reader.
-- ---------------------------------------------------------------------------
create or replace function public.company_business_memory(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', (
      select to_jsonb(t) from public.company_business_profiles t
      where t.company_id = p_company_id
      limit 1
    ),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.is_primary desc)
      from public.company_locations t
      where t.company_id = p_company_id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.day_of_week)
      from public.company_business_hours t
      where t.company_id = p_company_id and t.location_id is null
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'title', t.title, 'category', t.category,
          'content', t.content, 'created_at', t.created_at
        ) order by t.created_at desc
      )
      from public.company_policies t
      where t.company_id = p_company_id and t.is_active
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc)
      from public.company_services t
      where t.company_id = p_company_id and t.is_active
    ), '[]'::jsonb),
    'faqs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id, 'question', t.question, 'answer', t.answer, 'category', t.category
        ) order by t.created_at desc
      )
      from public.company_faqs t
      where t.company_id = p_company_id and t.is_active
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.company_business_memory(uuid) from public, anon, authenticated;
grant  execute on function public.company_business_memory(uuid) to service_role;
