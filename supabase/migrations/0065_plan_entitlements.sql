-- ===========================================================================
-- Migration 0065 — Per-company feature overrides
--
-- Plans decide which product areas a company gets (`PLAN_FEATURES` in
-- src/modules/super-admin/plans.ts). That is the rule, and this column is the
-- exception to it: an operator agreeing to give one company WhatsApp on a
-- Starter plan, or grandfathering a customer who has been using guided chats
-- since before they were charged for, should not have to invent a bespoke plan
-- in the billing catalogue that then has to be maintained forever.
--
-- WHY A COLUMN AND NOT A TABLE
-- ----------------------------
-- The shape of the data is "a handful of booleans belonging to exactly one
-- subscription", and `subscriptions.company_id` is already unique, so a table
-- would buy a join and a second write path and nothing else. The same argument
-- the agency branding blob made in 0057 applies here: adding a feature name
-- must not cost a migration, because the list of features changes with the
-- product and the column has to keep working for rows written before it did.
--
-- WHY IT IS NULLABLE
-- ------------------
-- Null means "this company has no exception", which is every company today, and
-- is distinguishable from `{}` — an operator who granted something and then took
-- it away again. `src/lib/entitlements.ts` treats both as no override, but the
-- distinction is worth keeping for anyone reading the table.
--
-- The value is `{"whatsapp": true, "api_access": false}` — a flat object of
-- feature name to boolean. Unknown keys and non-boolean values are ignored by
-- the reader rather than rejected here, so a typo in an operator's hand-written
-- JSON can never deny a company a feature it is paying for.
--
-- ACCESS
-- ------
-- No new policy. `subscriptions` already lets super admins do everything and
-- lets company members read their own row (migration 0004), which is exactly
-- what this column needs: operators write it, and the company's own billing
-- page reads it back to say what the account includes.
-- ===========================================================================

alter table public.subscriptions
  add column if not exists feature_overrides jsonb;

-- A guard, not validation. The reader copes with any shape, but storing an
-- array or a bare string here is always a mistake and is worth failing on at
-- the moment it is written rather than silently ignoring at every read.
alter table public.subscriptions
  drop constraint if exists subscriptions_feature_overrides_object;
alter table public.subscriptions
  add constraint subscriptions_feature_overrides_object
  check (feature_overrides is null or jsonb_typeof(feature_overrides) = 'object');
