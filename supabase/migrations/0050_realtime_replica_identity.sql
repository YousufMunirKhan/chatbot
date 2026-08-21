-- ===========================================================================
-- Migration 0050 — Realtime replica identity for the inbox
-- Migration 0005 added `conversations` and `messages` to the `supabase_realtime`
-- publication but left both tables on the default REPLICA IDENTITY (primary key
-- only). With RLS enabled, Realtime re-checks each change against the
-- subscriber's policies using the row in the WAL record — for an UPDATE the old
-- tuple carries nothing but the id, so `company_id` is missing and the policy
-- cannot pass. The event is then silently dropped and the Inbox stops moving
-- until a full reload.
--
-- REPLICA IDENTITY FULL writes every column into the WAL for UPDATE/DELETE, so
-- the tenant check has the data it needs. Idempotent: re-running is a no-op.
-- ===========================================================================

alter table public.conversations replica identity full;
alter table public.messages replica identity full;
