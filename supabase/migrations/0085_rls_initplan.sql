-- ===========================================================================
-- Migration 0085 — Evaluate the RLS super-admin helper once per query
--
-- Postgres treats a bare function call in a policy's USING/WITH CHECK
-- expression as part of the row filter, so `is_super_admin()` is called once
-- for EVERY row the policy examines. Wrapped in a scalar subquery —
-- `(select public.is_super_admin())` — the planner lifts it into an InitPlan:
-- it runs once before the scan starts and the result is reused for every row.
--
-- Today that costs nothing; the largest table in this database holds a few
-- thousand rows. It stops being free at the volume this product is sold into:
-- an inbox scanning 2,000,000 messages currently means 2,000,000 calls to a
-- `security definer` function that itself reads `public.users`. That is the
-- difference between an inbox that opens and one that times out.
--
-- WHY EVERY REWRITE HERE IS SET-IDENTICAL
-- `is_super_admin()` takes no arguments and reads nothing from the row being
-- filtered — it reads one row of `public.users` for `auth.uid()`. Its value is
-- therefore constant across every row of any one query: the predicate is true
-- for all rows or for none. `(select f())` is a scalar subquery over a
-- one-row Result node, so it yields exactly the value `f()` yields — true for
-- true, false for false, null for null. The set of rows the policy admits is
-- byte-for-byte the same before and after. There is no arrangement of data
-- that makes the wrapped form admit a row the bare form refused, which is the
-- only direction that would matter: a widened policy here is a cross-tenant
-- leak.
--
-- Each policy is checked against its CURRENT definition in `pg_policies`
-- before it is touched. A policy that is not exactly the stock super-admin
-- policy — different command, different roles, a hand-edited expression — is
-- left alone and reported, and a policy that is absent is NOT created, because
-- creating one would grant access that did not exist a moment earlier.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--  * The `<table>_select_members` policies. They read
--    `company_id in (select public.user_company_ids())`, which is already an
--    uncorrelated sublink: the planner builds the hash once per query, not per
--    row. There is nothing to win and a tenant-isolation predicate is not
--    worth rewriting for nothing.
--  * The stock super-admin policy on settings-shaped tables — `bots`,
--    `company_settings`, `billing_plans`, `nlu_settings`, `sla_policies` and
--    the rest that hold one row per company or a fixed handful platform-wide.
--    A per-row call over four rows is not a cost, and every policy rewritten
--    is a policy that can be got wrong.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Volatility
--
-- A VOLATILE function cannot be cached at any level: the planner must call it
-- per row however the policy is written, so the InitPlan rewrite below would
-- buy nothing at all. Both helpers were declared `stable` where they were
-- created (`user_company_ids()` in 0002, `is_super_admin()` in 0003), so these
-- two statements are no-ops against the current database. They are here so the
-- property the rest of this migration depends on is asserted in the migration
-- that depends on it, instead of being taken on trust from two other files.
-- ---------------------------------------------------------------------------
alter function public.is_super_admin() stable;
alter function public.user_company_ids() stable;

-- ---------------------------------------------------------------------------
-- 2. The super-admin policies on the tables that carry row volume
--
-- `create policy` cannot be altered in place, so each one is dropped and
-- recreated. The only change is the subquery wrapping; command, roles and
-- expression are otherwise reproduced exactly.
--
--   before: for all to authenticated
--           using (public.is_super_admin())
--           with check (public.is_super_admin())
--
--   after:  for all to authenticated
--           using ((select public.is_super_admin()))
--           with check ((select public.is_super_admin()))
--
-- Both admit exactly the rows of the table when the caller is a platform
-- super admin and no rows otherwise, for SELECT, INSERT, UPDATE and DELETE
-- alike. The service-role key still bypasses RLS entirely and is unaffected.
-- ---------------------------------------------------------------------------
do $$
declare
  t         text;
  v_policy  text;
  v_qual    text;
  v_check   text;
  v_cmd     text;
  v_roles   name[];
  v_rewrote int := 0;
  v_skipped int := 0;
begin
  foreach t in array array[
    -- Conversations and everything hanging off a conversation. The inbox.
    'conversations', 'messages', 'message_attachments',
    'conversation_internal_notes', 'conversation_ratings',
    -- Knowledge base. `chunks` is the retrieval hot path and grows fastest of
    -- the four: one row per passage per document per company.
    'documents', 'document_sources', 'chunks', 'ingestion_jobs',
    -- Captured work.
    'leads', 'appointments', 'notifications',
    -- People and the identities that resolve to them.
    'contacts', 'contact_identities', 'contact_notes', 'contact_subscriptions',
    'contact_group_members', 'channel_identities', 'agent_group_members',
    'push_subscriptions',
    -- Logs and event streams. These hold the highest row counts in the
    -- database and only ever grow.
    'ai_usage_logs', 'audit_logs', 'security_audit_logs', 'admin_access_logs',
    'application_error_logs', 'answer_quality_logs', 'answer_quality_feedback',
    'quick_action_clicks', 'platform_setting_events',
    'notification_delivery_logs', 'push_delivery_log', 'webhook_deliveries',
    'api_request_logs', 'rest_hook_events', 'report_deliveries',
    'helpdesk_connector_events', 'helpdesk_connector_health_logs',
    'helpdesk_action_audit_logs', 'channel_inbound_events',
    'channel_comment_events', 'flow_sessions', 'flow_node_events',
    'sla_states', 'sla_events', 'data_erasure_logs', 'data_subject_requests',
    'agent_presence', 'google_calendar_events',
    -- Queues, caches and run histories.
    'background_jobs', 'dead_letter_jobs', 'ai_answer_cache', 'sync_jobs',
    'eval_runs', 'automation_runs', 'ai_insight_runs', 'ai_insights',
    'company_credit_transactions', 'company_auto_topup_attempts',
    -- Commerce: carts and orders scale with conversations, the synced
    -- catalogue scales with the customer's own store.
    'chat_carts', 'chat_cart_items', 'chat_orders', 'chat_order_items',
    'payments', 'synced_customers', 'synced_products',
    'synced_product_variants', 'synced_inventory', 'synced_orders',
    'synced_order_items', 'restaurant_menu_items', 'restaurant_menu_variants',
    'modifier_groups', 'modifiers', 'menu_item_modifier_groups',
    'combo_groups', 'combo_options',
    -- Authored content that grows with the account rather than with the plan.
    'help_articles', 'help_categories', 'broadcasts', 'proactive_campaigns'
  ]
  loop
    v_policy := t || '_super_admin_all';

    if to_regclass('public.' || quote_ident(t)) is null then
      raise warning '0085: public.% does not exist - skipped', t;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select p.qual, p.with_check, p.cmd, p.roles
      into v_qual, v_check, v_cmd, v_roles
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename  = t
       and p.policyname = v_policy;

    -- Absent is not the same as wrong. If somebody removed this policy on
    -- purpose, recreating it would hand super admins access they no longer
    -- have, which is a change of behaviour and not the point of this file.
    if not found then
      raise warning '0085: policy % on public.% is absent - not recreated', v_policy, t;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Normalising away whitespace, the optional schema qualification and the
    -- parentheses leaves the bare stock expression as the single string
    -- `is_super_admin`. Anything else — a negation, an extra conjunct, a
    -- different helper — fails this test and is left exactly as it is, because
    -- this migration only knows how to reproduce the stock expression.
    if v_cmd is distinct from 'ALL'
       or v_roles is distinct from array['authenticated']::name[]
       or regexp_replace(coalesce(v_qual, ''), '\s|public\.|\(|\)', '', 'g') <> 'is_super_admin'
       or regexp_replace(coalesce(v_check, ''), '\s|public\.|\(|\)', '', 'g') <> 'is_super_admin'
    then
      raise warning
        '0085: policy % on public.% is not the stock super-admin policy (cmd=%, roles=%, using=%, check=%) - left alone',
        v_policy, t, v_cmd, v_roles, v_qual, v_check;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    execute format('drop policy %I on public.%I', v_policy, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_super_admin())) with check ((select public.is_super_admin()))',
      v_policy, t);
    v_rewrote := v_rewrote + 1;
  end loop;

  raise notice '0085: % super-admin policies rewritten as InitPlans, % left alone', v_rewrote, v_skipped;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The chat-attachment objects policy (migration 0077)
--
-- `storage.objects` is one table shared by every bucket in the project, so its
-- policies are examined against every object row a signed-in browser touches,
-- not just the attachments. That makes the per-row helper call here worth
-- removing even though the bucket itself is small.
--
--   before: bucket_id = 'chat-attachments'
--           and (public.is_super_admin() or exists (...))
--   after:  bucket_id = 'chat-attachments'
--           and ((select public.is_super_admin()) or exists (...))
--
-- Same three admitted sets, unchanged: nothing outside the chat-attachments
-- bucket; every object in it for a platform super admin; and for everyone else
-- only objects whose first path segment is one of the caller's company ids.
-- The `exists` clause is reproduced verbatim — it is correlated on `name`, so
-- there is no subquery wrapping available for it, and rewriting its shape
-- would be a change of expression rather than a change of evaluation.
-- ---------------------------------------------------------------------------
do $outer$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'chat_attachments_select_own_company'
  ) then
    raise warning '0085: storage.objects policy chat_attachments_select_own_company is absent - not recreated';
  else
    execute $pol$drop policy chat_attachments_select_own_company on storage.objects$pol$;
    execute $pol$
      create policy chat_attachments_select_own_company on storage.objects
        for select to authenticated
        using (
          bucket_id = 'chat-attachments'
          and (
            (select public.is_super_admin())
            or exists (
              -- Through `user_company_ids()` rather than reading `company_users`
              -- directly: that table has RLS of its own, and the function is
              -- `security definer` precisely so a policy can ask it.
              select 1
              from public.user_company_ids() as cid
              where cid::text = split_part(name, '/', 1)
            )
          )
        )
    $pol$;
    raise notice '0085: storage.objects chat_attachments_select_own_company rewritten as an InitPlan';
  end if;
end
$outer$;

-- ---------------------------------------------------------------------------
-- 4. Say out loud what is left
--
-- The settings-shaped tables keep the bare call on purpose (see the header).
-- This notice puts the remaining count in the migration output so the next
-- person reads a number rather than assuming the job either finished or never
-- started.
-- ---------------------------------------------------------------------------
do $$
declare v_left int;
begin
  select count(*)
    into v_left
    from pg_policies
   where (coalesce(qual, '') like '%is_super_admin()%'
          and coalesce(qual, '') not like '%SELECT is_super_admin()%')
      or (coalesce(with_check, '') like '%is_super_admin()%'
          and coalesce(with_check, '') not like '%SELECT is_super_admin()%');
  raise notice
    '0085: % policies still call is_super_admin() per row; these are the settings-sized tables and are left on purpose',
    v_left;
end $$;
