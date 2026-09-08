-- ===========================================================================
-- Migration 0084 — Index hygiene: cover the foreign keys that hurt, drop the
-- single-column indexes that later migrations already replaced.
--
-- Two findings came out of 108 days of production statistics.
--
-- FINDING A — 120 of 258 foreign keys have no index on their own columns. The
-- symptom is `delete from public.companies where id = $1`: 136.66ms mean and
-- 499.7ms max over 28 calls, on a table holding two rows. None of that time is
-- the row. Postgres has to prove no child row is orphaned, and for every
-- constraint pointing at `companies` with no usable index that proof is a
-- sequential scan of the child table. Worse, the cascade is recursive: deleting
-- a company deletes its conversations, and EVERY deleted conversation fires its
-- own referential check against each child of `conversations`. A tenant with
-- five thousand conversations means five thousand scans of `ai_usage_logs`.
-- That, not the two-row parent, is the 499ms.
--
-- The fix is NOT to index all 120. An index is paid for on every insert and on
-- every update that cannot go HOT, so covering a settings table that holds one
-- row per company buys a scan of one page and costs writes forever. The
-- thirteen indexes below were chosen on three tests, all three of which had to
-- point the same way:
--   1. does the child table grow without bound in normal operation (a log, a
--      queue, an event stream, a line-item table) rather than sit at a handful
--      of rows per tenant;
--   2. is the parent actually deleted — either by application code (grep for
--      `.delete()` on it) or by a cascade that reaches it from `companies`;
--   3. does the column show up as a filter in `src/`, so the index pays for
--      itself on reads as well as on the delete.
-- Everything that failed those tests is named at the bottom of this file with
-- the reason, because an index nobody needed is the same mistake as a missing
-- one, only quieter.
--
-- FINDING B — 136 indexes were never scanned in 108 days. Most of them back a
-- unique or primary key constraint and cannot be dropped at all. Of the rest,
-- the honest answer for most is that the FEATURE is unused, not the index:
-- nobody has switched on flows, Zapier hooks, scheduled reports or CSAT on
-- these two tenants, so of course the indexes that serve them have never been
-- scanned. Dropping those just means recreating them the week someone buys the
-- plan. What IS safe to drop is a narrower thing that can be proved from the
-- migrations alone: twelve single-column indexes whose columns are the exact
-- leading prefix of a wider, non-partial index added by a later migration, plus
-- one more whose only consumer a later migration moved off it in writing. A
-- btree on (a, b) answers everything a btree on (a) answers, so the narrow one
-- has no query left that prefers it — which is exactly why the statistics say
-- it was never scanned. 0060's own header says as much out loud about the
-- `company_id`-only indexes from 0005.
--
-- Locks: this repo's runner wraps each migration in one transaction, so
-- CREATE INDEX CONCURRENTLY is not available here and these statements take a
-- SHARE lock that blocks writes to the table while the index builds. On
-- `chunks`, `messages` and `ai_usage_logs` that is worth planning for. Every
-- create below is `if not exists`, so the safe play on a busy database is to
-- build them by hand with CONCURRENTLY first and let this migration no-op.
--
-- No new tables and no policy changes: every table touched here already enables
-- row level security with the policies from its own migration, and an index
-- changes only how rows are found, never which rows a policy allows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PART A — foreign key indexes worth their write cost
-- ---------------------------------------------------------------------------

-- chunks.document_id — the single worst gap in the schema. `chunks` is the
-- largest table in a RAG product (one PDF is roughly 250 rows) and the column
-- is both a cascade target and a hot application filter: re-ingesting a
-- document runs `delete from chunks where document_id = ? and company_id = ?`
-- twice in src/lib/knowledge/ingest-queue.ts, and deleting one from the
-- knowledge page cascades here. Today every one of those is a full scan of the
-- whole tenant's knowledge base.
create index if not exists idx_chunks_document
  on public.chunks(document_id);

-- ingestion_jobs.document_id — one row per ingest, never pruned, and the same
-- document delete cascades into it. Cheap to maintain: the table is written
-- once and updated once per job.
create index if not exists idx_ingestion_jobs_document
  on public.ingestion_jobs(document_id);

-- ai_usage_logs.conversation_id — one row per AI call, never pruned, so this is
-- the biggest log table here. The FK is `on delete set null`, which still has to
-- FIND the rows, and conversations are deleted in bulk: the GDPR erasure in
-- src/modules/company/gdpr-actions.ts deletes a person's conversations with
-- `.in('id', convoIds)`, and a company delete cascades through every
-- conversation the tenant ever had. One scan of this table per conversation is
-- the whole 499ms outlier.
create index if not exists idx_ai_usage_conversation
  on public.ai_usage_logs(conversation_id);

-- sla_events.conversation_id — an append-only event stream that gains rows for
-- the life of every conversation, and a `cascade` rather than a `set null`, so
-- the rows must actually be found and removed on each conversation delete.
create index if not exists idx_sla_events_conversation
  on public.sla_events(conversation_id);

-- message_attachments.conversation_id — also `cascade`, and grows with every
-- file a visitor or agent uploads. 0077 indexed
-- (company_id, conversation_id, created_at) for the thread read, but a
-- referential check can only use an index whose LEADING column is the
-- constrained one, so that composite does nothing for the cascade.
create index if not exists idx_message_attachments_conversation_fk
  on public.message_attachments(conversation_id);

-- conversation_internal_notes had no index at all. This one index does two
-- jobs: it covers the `companies` cascade, and it serves the note list that
-- src/modules/company/inbox-data.ts reads on every single conversation open,
-- filtering exactly (company_id, conversation_id) ordered by created_at. That
-- read is a sequential scan today.
create index if not exists idx_conversation_internal_notes_conversation
  on public.conversation_internal_notes(company_id, conversation_id, created_at);

-- quick_action_clicks.conversation_id — the widget's quick action buttons are
-- core, not a paid extra, so this table gains a row per click and is never
-- pruned. `set null` on conversation delete, once per conversation.
create index if not exists idx_quick_action_clicks_conversation
  on public.quick_action_clicks(conversation_id);

-- notification_delivery_logs.conversation_id — one row per notification sent,
-- never pruned, same per-conversation `set null` cost on erasure and on the
-- company cascade.
create index if not exists idx_notification_delivery_logs_conversation
  on public.notification_delivery_logs(conversation_id);

-- background_jobs.company_id — the job queue keeps completed rows forever, so
-- it is the largest unindexed direct child of `companies`. Its only index is
-- (status, run_after, created_at) for the runner, which cannot serve the
-- cascade. Nothing reads this table by company, so this index is bought purely
-- for the delete — justified because the table grows with every enqueue and the
-- write cost is one entry on an insert that is already non-HOT (the runner
-- updates the indexed `status` column on every job anyway).
create index if not exists idx_background_jobs_company
  on public.background_jobs(company_id);

-- security_audit_logs.company_id — a row per login, 2FA change and permission
-- change, never pruned, and `on delete set null` means a company delete has to
-- find and UPDATE every one of them. 0018 indexed created_at and user_id but
-- not company_id. created_at rides along because the two places that read this
-- table both order by it newest-first.
create index if not exists idx_security_audit_company_created
  on public.security_audit_logs(company_id, created_at desc);

-- synced_order_items.company_id — the store sync writes one row per line of
-- every order it pulls, which makes this the largest of the commerce tables for
-- any tenant with a shop connected. Its only index is (order_id), which serves
-- the sync's own delete-then-insert but not the company cascade.
create index if not exists idx_synced_order_items_company
  on public.synced_order_items(company_id);

-- webhook_deliveries.endpoint_id — a delivery log that gains a row per webhook
-- event per endpoint, against a parent users delete from the webhooks settings
-- page (src/modules/company/webhooks-actions.ts, src/lib/api/hooks.ts). The FK
-- is `cascade`, so removing one endpoint currently scans the entire delivery
-- history to find its rows.
create index if not exists idx_webhook_deliveries_endpoint
  on public.webhook_deliveries(endpoint_id);

-- push_delivery_log.subscription_id — the parent is not deleted rarely by an
-- admin, it is deleted automatically: src/lib/push/index.ts prunes a
-- subscription every time a browser endpoint comes back dead, inside the same
-- fan-out loop that appends to this log. Frequent parent delete against a table
-- that grows with every notification is the worst shape to leave unindexed.
create index if not exists idx_push_delivery_log_subscription
  on public.push_delivery_log(subscription_id);

-- ---------------------------------------------------------------------------
-- PART B — drop the single-column indexes a later migration already superseded
--
-- Each one below is non-unique and backs no constraint, and for all but the
-- last its column list is the exact leading prefix of a wider NON-PARTIAL index
-- on the same table, named on the line above it. Nothing that used the narrow
-- index loses an access path; the wider index answers the same lookups, which
-- is why the statistics show these were never scanned. Every drop also leaves
-- the table's own foreign key still covered, because the surviving index starts
-- with the same column.
-- ---------------------------------------------------------------------------

-- Superseded eight times over: idx_conversations_inbox (0005),
-- idx_conversations_company_status_activity (0032),
-- idx_conversations_company_started (0060), the three (company_id, …) pairs
-- from 0069, and idx_conversations_contact / idx_conversations_visitor (0076).
drop index if exists public.idx_conversations_company;

-- Superseded by idx_messages_company_created (company_id, created_at desc),
-- added in 0032 and again in 0060 — whose header says outright that 0005
-- indexed company_id alone and that the reports range scan needed created_at.
drop index if exists public.idx_messages_company;

-- Duplicate of idx_messages_conversation (conversation_id, created_at) from
-- 0005: the two differ only in the sort direction of the second column, and a
-- btree scans backwards, so either one answers both orderings once
-- conversation_id is an equality. The 0005 index is kept because it is also the
-- foreign key cover for messages.conversation_id.
drop index if exists public.idx_messages_conversation_created_desc;

-- Superseded by idx_chunks_company_audience (0034) and
-- idx_chunks_company_language (0042).
drop index if exists public.idx_chunks_company;

-- Superseded by idx_documents_company_audience (0034),
-- idx_documents_company_status and uq_documents_company_source_url (0075).
drop index if exists public.idx_documents_company;

-- Superseded by idx_audit_logs_company_created (0032).
drop index if exists public.idx_audit_logs_company;

-- A same-migration duplicate: 0011 created both (company_id, created_at desc)
-- and (company_id, created_at). Every read here — the cost-control spend check,
-- the billing message count, the agency roll-up — is `company_id` plus a
-- created_at range, which either index answers equally well.
drop index if exists public.idx_ai_usage_company;

-- Superseded by idx_chat_carts_abandon_scan (company_id, status, updated_at)
-- from 0055.
drop index if exists public.idx_chat_carts_company;

-- Superseded by idx_synced_customers_lookup (0009),
-- uq_synced_customers_external (0064) and idx_synced_customers_contact (0076).
drop index if exists public.idx_synced_customers_company;

-- Superseded by idx_synced_orders_lookup (0009),
-- idx_synced_orders_company_created (0060), uq_synced_orders_external (0064)
-- and idx_synced_orders_contact (0076).
drop index if exists public.idx_synced_orders_company;

-- Superseded by idx_synced_products_retailer (0054) and
-- uq_synced_products_external (0064).
drop index if exists public.idx_synced_products_company;

-- Superseded inside its own migration by idx_message_attachments_conversation
-- (company_id, conversation_id, created_at) from 0077.
drop index if exists public.idx_message_attachments_company;

-- Not a prefix duplicate, but dead for a reason 0080 wrote down itself: the
-- only consumer of `lower(email)` on this table is the
-- company_users_adopt_invite trigger, and 0080 moved it onto
-- (company_id, lower(email)) precisely because matching an address across every
-- company was wrong. Nothing in `src/` looks an invitation up by email alone —
-- acceptance goes through token_hash — so this index has no query left.
drop index if exists public.idx_agent_invites_email;

-- ===========================================================================
-- WHAT WAS DELIBERATELY LEFT ALONE
--
-- Not indexed, from Finding A's list of 120:
--
--   * Every `updated_by` / `created_by` / `actor_user_id` column pointing at
--     `users` — forty of them. They sit on settings and configuration tables
--     that hold one row per company (bot_settings, company_settings,
--     platform_settings, widget_prechat_settings, legal_documents,
--     stripe_price_mappings, billing_plans, company_ai_budgets). Scanning a
--     two-row table costs one page; indexing forty columns costs every write
--     forever. Users are also deleted almost never, and always one at a time.
--
--   * Every `bot_id` column — fifteen of them. `bots` is never deleted on its
--     own anywhere in `src/`; it only disappears when its company does, and a
--     company has one to three bots, so the whole cascade is a couple of scans
--     rather than one per row. The bot_id columns that ARE read filters
--     (chunks, documents, conversations, answer_quality_logs) already have
--     their indexes from 0006, 0005 and 0015.
--
--   * voice_transcripts_future, kitchen_routing_rules, combo_groups,
--     combo_options and availability_rules — the migrations create them and
--     nothing in `src/` ever writes to them. They are empty, an empty scan is
--     free, and the day one of them gets its feature is the day to index it.
--
--   * The restaurant catalogue (restaurant_menu_variants, modifiers,
--     modifier_groups, menu_item_modifier_groups). These are read per chat turn
--     with no index at all, which looks alarming, but they are bounded by the
--     size of a menu — hundreds of rows, not millions — and neither tenant on
--     this database is a restaurant. Revisit this together with the read paths
--     in src/lib/tools/products.ts if a restaurant tenant onboards.
--
--   * rest_hook_events.company_id — the drain in src/lib/api/hooks.ts prunes
--     claimed rows on every run, so the table is bounded by the prune window
--     rather than by traffic, and no query filters it by company.
--
--   * chat_cart_items, chat_order_items, payments, dead_letter_jobs,
--     data_subject_requests, flow_versions, sla_policies — real tables with
--     real rows, but their growth is bounded by something rare (a chat order, a
--     job that failed its retries, a GDPR request, an admin saving a flow).
--     They each already carry the index their own read path needs.
--
--   * sla_events.policy_id and sla_states.policy_id — deleting an SLA policy is
--     a rare admin action. Worth revisiting if the SLA settings page gets slow,
--     but not worth two more indexes on an event stream today.
--
-- Not dropped, from Finding B's 136:
--
--   * Everything belonging to a feature nobody has switched on yet — the flow
--     builder (idx_flow_sessions_company, idx_flows_live, idx_bot_intents_company),
--     Zapier/REST hooks (rest_hook_*), scheduled reports
--     (idx_report_schedules_due), AI insights, the help centre, broadcasts,
--     WhatsApp templates, CSAT (idx_conversation_ratings_company_created) and
--     web push. These are unscanned because the feature is unused, not because
--     the index is wrong, and dropping them only means recreating them on the
--     day someone buys the plan.
--
--   * idx_sla_states_response_due and idx_sla_states_resolution_due. These are
--     partial indexes for the SLA sweeper, and a sweeper that is not currently
--     on a schedule reports zero scans. The moment it runs, dropping these
--     turns it into a repeated full scan.
--
--   * idx_conversations_activity (last_message_at desc). It has no company_id
--     and every tenant-facing list is company-scoped, so it looks like dead
--     weight — but src/modules/super-admin/chat-logs-data.ts orders the
--     cross-tenant chat log by exactly this column, and that is the one read in
--     the codebase no company-scoped index can serve.
--
--   * idx_application_error_logs_created and the partial
--     idx_application_error_logs_unresolved. The super-admin error list reads
--     across tenants; the partial is not a prefix duplicate of anything.
--
--   * Every index whose columns are a prefix of a PARTIAL index only. A partial
--     index is unusable for rows outside its predicate and unusable for a
--     referential check, so it supersedes nothing.
-- ===========================================================================
