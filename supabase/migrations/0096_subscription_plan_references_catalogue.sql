-- ===========================================================================
-- Migration 0096 — `subscriptions.plan` points at the plan catalogue
--
-- WHAT THE OLD RULE COST
-- ----------------------
-- Migration 0004 declared `plan text ... check (plan in ('free_trial','starter',
-- 'growth','pro','custom'))`. Migration 0025 then made the catalogue editable
-- inside the product — `billing_plans` is a table an operator adds packages to
-- on the Billing & Plans screen, and `stripe_price_mappings` (0018) lets them
-- point a Stripe price at any key in it. From that moment the column enumerated
-- a list the product itself could grow past, and every path that writes a sixth
-- key was rejected with a 23514:
--
--   * `customer.subscription.updated` (src/app/api/webhooks/stripe/route.ts)
--     failed on every delivery, so Stripe retried for about three days and then
--     dropped the event. The customer had paid and nothing here knew.
--   * `updateSubscriptionAction` (src/modules/super-admin/actions.ts) —
--     the COMP path — could not grant an operator-created package at all. The
--     one capability this product is built around was refused by the schema.
--
-- 0025 already ran `drop constraint if exists subscriptions_plan_check`, so a
-- database that has been through every migration in order is not carrying the
-- enumeration today. That drop is repeated below rather than trusted: it was a
-- side effect of the migration that created `billing_plans`, it silently does
-- nothing if the constraint was ever created under another name, and this file
-- is the one that should own the column's rule from now on.
--
-- WHY A FOREIGN KEY AND NOT A WIDER LIST
-- --------------------------------------
-- Any enumeration written here goes stale the next time an operator adds a
-- package, which is the whole fault. But "no rule at all" is not the answer
-- either: `plan` is read by `src/lib/entitlements.ts`, by the credit
-- replenishment in `src/lib/billing/credits.ts` and by the revenue reports, and
-- a key none of them can resolve is a company whose features, monthly top-up
-- and reported revenue all quietly fall back to a default nobody chose. The
-- constraint that cannot go stale is the catalogue itself.
--
--   on update cascade — an operator who renames a package key takes the
--   companies on it along, instead of orphaning them.
--
--   on delete restrict — deleting a package that companies are still on is
--   refused. Nothing in the product deletes a `billing_plans` row (the screen
--   upserts, and retiring a package is `is_active = false`), so this costs an
--   operator nothing in normal use and is exactly the accident worth stopping:
--   a comped or paying company must never be left pointing at a key nothing can
--   resolve. An operator who really wants a package gone moves its companies
--   first, which is the order that keeps them correct anyway.
--
-- This is strictly MORE permissive in the direction that was hurting — any
-- package in the catalogue may now be sold, comped or renewed — and stricter
-- only about the one value that has no meaning.
--
-- ROWS THAT WOULD FAIL THE NEW RULE
-- ---------------------------------
-- A key on a subscription with no catalogue row cannot be repaired by guessing a
-- replacement: moving those companies to `custom` or `free_trial` would rewrite
-- a paying customer's package to settle a schema argument. Instead the missing
-- catalogue row is created, inactive and non-public, from what the companies on
-- that key already have — so the key resolves, nothing on any company row moves,
-- and the operator gets a labelled row to correct. `included_credit_gbp` is 0
-- because a zero here is not an answer: `resolveIncludedCredit` in
-- src/lib/billing/credits.ts treats a catalogue zero as "nobody has said", falls
-- through to the static PLANS map, and then — for a package that caps no reply
-- count — to the uncapped-plan floor. So the recovered row grants exactly what
-- the key already resolved to while the catalogue had lost it, and changes no
-- behaviour; it only makes the state describable. (An earlier draft of this
-- comment named a function `includedCreditForPlan`, which does not exist — the
-- resolution lives in `resolveIncludedCredit` and its caller
-- `includedCreditForSubscription`.) This is expected to match nothing on a
-- healthy database.
--
-- SAFE TO RUN TWICE.
-- ===========================================================================

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;

insert into public.billing_plans (
  key, label, description, price_monthly_gbp,
  message_limit, bot_limit, agent_limit, integration_limit,
  included_credit_gbp, trial_days, is_public, is_default, is_active, sort_order
)
select
  s.plan,
  'Recovered: ' || s.plan,
  'Created by migration 0096 for companies already on this package key when it '
    || 'had no catalogue row. Limits are what those companies hold, so applying '
    || 'this package changes nothing. Price and included credit need an operator.',
  0,
  -- A null limit means unlimited, so one company holding null makes the
  -- recovered package unlimited: this row must not describe less than what the
  -- companies on it already have.
  case when bool_or(s.message_limit is null) then null else max(s.message_limit) end,
  case when bool_or(s.bot_limit is null) then null else max(s.bot_limit) end,
  case when bool_or(s.agent_limit is null) then null else max(s.agent_limit) end,
  case when bool_or(s.integration_limit is null) then null else max(s.integration_limit) end,
  0,
  null,
  false,  -- never offered on the pricing page
  false,  -- not one of the packages this product ships with
  false,  -- and not offered in checkout until an operator says so
  900
from public.subscriptions s
left join public.billing_plans p on p.key = s.plan
where p.key is null
group by s.plan
on conflict (key) do nothing;

-- `add constraint` has no `if not exists`, and this migration has to stay
-- re-runnable like every other one in this directory.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_plan_fkey'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_fkey
      foreign key (plan) references public.billing_plans(key)
      on update cascade
      on delete restrict;
  end if;
end $$;

comment on column public.subscriptions.plan is
  'The package this company is on, as a key in billing_plans. Enforced by a foreign key rather than a list of names (migration 0096): operators create packages inside the product, so any fixed list goes stale and blocks both a Stripe upgrade and a super-admin comp onto the new package. Deleting a package companies are still on is refused; retire it with is_active = false instead.';
