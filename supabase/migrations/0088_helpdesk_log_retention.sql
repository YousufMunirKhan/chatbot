-- ===========================================================================
-- Migration 0088 — Nothing has ever deleted a helpdesk log row
--
-- `/api/cron/retention` calls `cleanup_old_chats()` and nothing else, and that
-- function (migration 0012) deletes from `public.conversations` alone. So three
-- append-only tables have been growing since the day they were created and have
-- never had a row removed:
--
--   helpdesk_connector_health_logs   one row per connector health check
--   helpdesk_connector_events        one row per connector event
--   helpdesk_action_audit_logs       one row per action a connector performed
--
-- The health-log table is at 6,860 rows today, which is nothing — but a health
-- check writes on a timer, so the row count is a function of uptime, not of how
-- much anybody uses the product. That is the shape that quietly becomes the
-- largest table in the database and then becomes a support ticket about a slow
-- page.
--
-- Ninety days is chosen because that is what these rows are FOR: diagnosing a
-- connector that is misbehaving now, and answering "when did this start". Nobody
-- debugs a webhook against last spring. The audit log gets a year, because it
-- records what a connector DID on a customer's behalf, and "who changed this
-- order, and when" is a question that arrives late.
--
-- Deleting in batches, oldest first, rather than one statement per table: a
-- single unbounded DELETE on a table this function has never run against before
-- would hold locks and bloat WAL for as long as it takes, and this runs on a
-- schedule where finishing later is completely acceptable. Each call removes at
-- most `p_max_rows` and reports what it did; the next run continues.
-- ===========================================================================

create or replace function public.cleanup_helpdesk_logs(p_max_rows integer default 20000)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  health_days   constant integer := 90;
  event_days    constant integer := 90;
  audit_days    constant integer := 365;
  budget        integer := greatest(coalesce(p_max_rows, 20000), 0);
  removed_health integer := 0;
  removed_events integer := 0;
  removed_audit  integer := 0;
begin
  -- The guard that matters is the grant below; this stops a re-grant made by
  -- accident from handing anybody a bulk delete. `auth.uid()` is null exactly
  -- when there is no end-user token, which is the server calling itself — the
  -- newer Supabase API keys are opaque, not JWTs, so reading a role claim here
  -- would be null for every caller including the legitimate one.
  if auth.uid() is not null and not public.is_super_admin() then
    raise exception 'not permitted';
  end if;

  if budget > 0 then
    with doomed as (
      select id from public.helpdesk_connector_health_logs
      where created_at < now() - make_interval(days => health_days)
      order by created_at
      limit budget
    )
    delete from public.helpdesk_connector_health_logs t
    using doomed d where t.id = d.id;
    get diagnostics removed_health = row_count;
    budget := budget - removed_health;
  end if;

  if budget > 0 then
    with doomed as (
      select id from public.helpdesk_connector_events
      where created_at < now() - make_interval(days => event_days)
      order by created_at
      limit budget
    )
    delete from public.helpdesk_connector_events t
    using doomed d where t.id = d.id;
    get diagnostics removed_events = row_count;
    budget := budget - removed_events;
  end if;

  if budget > 0 then
    with doomed as (
      select id from public.helpdesk_action_audit_logs
      where created_at < now() - make_interval(days => audit_days)
      order by created_at
      limit budget
    )
    delete from public.helpdesk_action_audit_logs t
    using doomed d where t.id = d.id;
    get diagnostics removed_audit = row_count;
  end if;

  return jsonb_build_object(
    'health_logs', removed_health,
    'connector_events', removed_events,
    'action_audit_logs', removed_audit,
    'health_days', health_days,
    'event_days', event_days,
    'audit_days', audit_days
  );
end;
$$;

revoke execute on function public.cleanup_helpdesk_logs(integer) from public;
revoke execute on function public.cleanup_helpdesk_logs(integer) from anon;
revoke execute on function public.cleanup_helpdesk_logs(integer) from authenticated;
grant execute on function public.cleanup_helpdesk_logs(integer) to service_role;

-- Deleting oldest-first needs to find oldest-first cheaply, and none of the
-- three tables is indexed on `created_at` alone.
create index if not exists idx_helpdesk_health_logs_created
  on public.helpdesk_connector_health_logs (created_at);
create index if not exists idx_helpdesk_connector_events_created
  on public.helpdesk_connector_events (created_at);
create index if not exists idx_helpdesk_action_audit_created
  on public.helpdesk_action_audit_logs (created_at);
