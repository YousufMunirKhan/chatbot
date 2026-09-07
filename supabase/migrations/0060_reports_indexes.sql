-- ===========================================================================
-- Migration 0060 — Access paths for the reports surface
--
-- The reports page reads "everything this company did in the last N days" from
-- six tables at once. Three of them are indexed on `company_id` alone, so a
-- 90-day range on a busy tenant meant fetching every conversation or message
-- the company has ever had and discarding the ones outside the window — the
-- cost grew with the tenant's whole history rather than with the range asked
-- for. These composite indexes put `created_at` / `started_at` in the index so
-- the range is a bounded scan.
--
-- No new tables, and therefore no new RLS policies: every table touched here
-- already enables row level security with the `_select_members` /
-- `_super_admin_all` pair from its own migration, and an index changes only how
-- rows are found, never which rows a policy allows. The reads themselves go
-- through the service-role client inside a `getCompanyId()`-scoped module.
-- ===========================================================================

-- Overview volume + heatmap + first contact resolution.
-- `idx_conversations_inbox` orders by last_message_at, which does not serve a
-- report keyed on when the conversation STARTED.
create index if not exists idx_conversations_company_started
  on public.conversations(company_id, started_at desc);

-- Every tab reads messages by company and window; 0005 indexed company_id only.
create index if not exists idx_messages_company_created
  on public.messages(company_id, created_at desc);

-- The Assistant tab's topic sample: visitor messages only, newest first.
create index if not exists idx_messages_company_visitor
  on public.messages(company_id, created_at desc)
  where sender_type = 'visitor';

-- Flow performance. 0053 indexed (flow_id, created_at), which cannot answer
-- "this company's flow events in this window" without touching every flow.
create index if not exists idx_flow_node_events_company_created
  on public.flow_node_events(company_id, created_at desc);

-- Team tab: first-response times come from the SLA audit trail, always filtered
-- to the one event type that records a response.
create index if not exists idx_sla_events_company_responded
  on public.sla_events(company_id, created_at desc)
  where event = 'responded';

-- Sales tab: store-synced orders in the window. 0009 indexed company_id alone.
create index if not exists idx_synced_orders_company_created
  on public.synced_orders(company_id, created_at desc);

-- Customers tab: appointments already have (company_id, created_at desc) from
-- 0007, chat_orders from 0010, conversation_ratings from 0039, automation_runs
-- and broadcasts from 0055/0046. Nothing to add for those.
