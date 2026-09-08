-- ===========================================================================
-- Migration 0093 — Per-company included credit, and wallet arithmetic that
--                  cannot lose a concurrent write
--
-- TWO DEFECTS LEFT OVER FROM 0089, BOTH IN THE SAME WALLET.
--
-- ---------------------------------------------------------------------------
-- 1. THE COMP PATH WAS DEAD ON THE ONE PACKAGE COMPING USES
-- ---------------------------------------------------------------------------
-- 0089 gave every paid package an included credit that can actually fund the
-- replies it advertises, and `replenishMonthlyCredit` puts that credit back
-- every month. It did nothing for `custom`, which is the package a comped or
-- negotiated deal is put on: `billing_plans.custom.included_credit_gbp` is 0
-- (seeded that way in 0025) and the static `PLANS` map agrees, so the resolved
-- figure was 0, and every funding path bails on `included <= 0`.
--
-- The result was the exact failure 0089 exists to remove, on the highest-value
-- accounts in the product. A company comped to `custom` has `message_limit`
-- null, so the reply gate always passes and the screens all read "unlimited" —
-- but provisioning created a `company_credit_accounts` row, so
-- `getAiCreditAccess` reports the wallet as TRACKED and requires a balance
-- above zero. The moment that opening balance ran out the assistant went
-- permanently silent, on the customer least likely to be told to check a
-- billing page.
--
-- The repair follows the pattern the product already uses for every other plan
-- limit. `subscriptions.message_limit`, `bot_limit`, `agent_limit` and
-- `integration_limit` are all per-company columns that a super-admin can set,
-- with the plan supplying the default when they are left alone. Included credit
-- is the fifth number of exactly that kind and was the only one with nowhere to
-- live, which is why `custom` — "negotiated per company" — had no way to carry
-- what was negotiated. It gets a column of its own below.
--
-- NULL means "inherit whatever the package says", which is what every existing
-- row wants, so there is no backfill: the resolution order in
-- `src/lib/billing/credits.ts` reads this column, then `billing_plans`, then the
-- `PLANS` map, and finally — for a package that sells UNLIMITED replies and
-- names no figure, which is `custom` and nothing else today — the largest
-- included credit in the price list. A plan with no reply cap must not be
-- capped by its wallet instead; funding it like the biggest thing a card can buy
-- is a floor an operator can raise, and it is the only answer that is not
-- silence. The reasoning is written out beside the constant in credits.ts.
--
-- ---------------------------------------------------------------------------
-- 2. REPLENISHMENT COULD DESTROY PURCHASED CREDIT
-- ---------------------------------------------------------------------------
-- Every wallet movement was a read-modify-write in TypeScript: read
-- `balance_amount`, compute, write the result back absolutely. Three callers do
-- it (`replenishMonthlyCredit`, `fundWalletForPlan` in the super-admin actions,
-- and `deductAiCreditForUsage` on the reply path), and all three lose any
-- write that lands between their own read and their own write.
--
-- CORRECTION, added after this migration shipped and its SQL deliberately left
-- alone: there was a FOURTH, and it was the one holding the most money.
-- `maybeAutoTopUp` (src/lib/billing/auto-topup.ts) read the balance, charged a
-- saved card — a network round trip of hundreds of milliseconds to seconds — and
-- then wrote the balance back from the figure it had read BEFORE the charge, so
-- every deduction and every replenishment landing in that window was destroyed.
-- It was not converted with the other three, which made the sentence above
-- ("every wallet movement") true of the design and false of the code. It goes
-- through `apply_credit_movement` now as well; the function below is unchanged
-- and needed no change to accept it.
--
-- The dangerous direction is not the one the old comment weighed. A deduction
-- lost to a replenishment costs a penny. A CREDIT lost to one costs the
-- customer their money: an auto top-up or a Stripe top-up landing in that gap is
-- overwritten by `balance_amount = included`, and the `top_up` ledger row
-- survives to claim the money was added. The books then say something the
-- balance does not. On the reply path the same shape drops deductions under
-- concurrent chat load, which is the leak the ledger exists to prevent.
--
-- Guarding the UPDATE with `balance_amount < included` does not fix it — the
-- ledger row is written first, so the row would then assert a grant that never
-- landed. The arithmetic has to be atomic with the ledger row, which means it
-- has to happen in one statement, in the database. `apply_credit_movement`
-- below is that statement: it takes the row lock, derives the delta from the
-- balance it is holding, writes the ledger row and moves the balance, and either
-- all of that happens or none of it does.
--
-- It is security definer because the wallet tables are RLS-protected, and its
-- guard is `auth.uid()` rather than a role claim: Supabase's newer API keys are
-- opaque, not JWTs, so `request.jwt.claim.role` is always null and a claim check
-- would refuse the server's own call (that is migration 0072's whole story).
-- Money never moves on behalf of an end user here, so the rule is simply that
-- there must not BE one — a non-null `auth.uid()` is a signed-in caller who has
-- reached a function they should not be able to see, and execute is granted to
-- `service_role` alone so they cannot.
-- ===========================================================================

-- This company's own included credit, in the same units as
-- `billing_plans.included_credit_gbp`. NULL is not zero: NULL inherits the
-- package, zero is an operator deciding this company gets no AI credit at all.
alter table public.subscriptions
  add column if not exists included_credit_gbp numeric(12,2);

comment on column public.subscriptions.included_credit_gbp is
  'Per-company monthly included AI credit in GBP. NULL inherits billing_plans.included_credit_gbp for the row''s plan. Set for negotiated and comped deals, which live on the `custom` package and have no catalogue figure of their own.';

-- One wallet movement: the ledger row and the balance, or neither.
--
-- Exactly one of p_amount (a signed delta — negative charges the wallet) and
-- p_target_balance (top up TO this figure, never past it, never down to it) is
-- given. "Top up TO" is the doctrine for every grant in this product: a customer
-- holding more than the package includes keeps all of it and gets nothing extra,
-- so no amount of re-running a grant can stack credit.
create or replace function public.apply_credit_movement(
  p_company_id        uuid,
  p_type              text,
  p_amount            numeric default null,
  p_target_balance    numeric default null,
  p_description       text    default null,
  p_metadata          jsonb   default '{}'::jsonb,
  p_provider_cost_usd numeric default null,
  p_ai_usage_log_id   uuid    default null,
  p_created_by        uuid    default null
)
returns table (
  status         text,
  amount_applied numeric,
  balance_before numeric,
  balance_after  numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_before   numeric;
  v_after    numeric;
  v_delta    numeric;
begin
  -- No end user ever moves money. A non-null caller means a signed-in session
  -- reached this function, which only a mistaken future grant could allow; see
  -- the header for why this is not a role-claim check.
  if auth.uid() is not null then
    raise exception 'apply_credit_movement is a server-side operation';
  end if;

  if (p_amount is null) = (p_target_balance is null) then
    raise exception 'apply_credit_movement needs exactly one of p_amount or p_target_balance';
  end if;

  -- `for update` is the whole point of this function. Holding the row means the
  -- delta below is derived from the balance this transaction will write back,
  -- not from one another transaction has already moved on from.
  select a.balance_amount, a.currency
    into v_before, v_currency
    from public.company_credit_accounts a
   where a.company_id = p_company_id
   for update;

  -- No wallet row means credit is not tracked for this company at all
  -- (`getAiCreditAccess` lets those replies through), so there is nothing to
  -- move and nothing is silently created here.
  if not found then
    return query select 'no_account'::text, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  v_delta := round(
    case
      when p_target_balance is null then p_amount
      else greatest(0::numeric, p_target_balance - v_before)
    end,
    4
  );

  -- A top-up TO a figure the wallet already exceeds is not a failure and must
  -- not leave a ledger row saying nothing happened.
  if v_delta = 0 then
    return query select 'no_change'::text, 0::numeric, v_before, v_before;
    return;
  end if;

  -- The ledger row goes first because for one caller it IS the lock: migration
  -- 0089's unique index allows a single `included_credit` row per company per
  -- UTC month, so two workers racing on the 1st cannot both grant. The loser
  -- lands here, and a duplicate is the lock working rather than an error —
  -- reported as such so the caller does not treat it as a fault.
  begin
    insert into public.company_credit_transactions (
      company_id, type, amount, currency, provider_cost_usd,
      ai_usage_log_id, description, metadata_json, created_by
    ) values (
      p_company_id, p_type, v_delta, coalesce(v_currency, 'GBP'), p_provider_cost_usd,
      p_ai_usage_log_id, p_description,
      -- The before/after figures are stamped HERE rather than passed in,
      -- because only this transaction knows what the balance really was. A
      -- caller's own read is exactly the stale number this function exists to
      -- stop trusting.
      coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object('balanceBefore', v_before, 'balanceAfter', v_before + v_delta),
      p_created_by
    );
  exception when unique_violation then
    return query select 'duplicate'::text, 0::numeric, v_before, v_before;
    return;
  end;

  -- Written as an increment, not an assignment, in both modes: for a target the
  -- delta was already measured against the locked row, so `+ v_delta` lands
  -- exactly on the target while still being arithmetic the database performs.
  -- Sign decides which lifetime total moves — money in was credit added, money
  -- out was usage charged.
  update public.company_credit_accounts as a
     set balance_amount         = a.balance_amount + v_delta,
         lifetime_credit_added  = a.lifetime_credit_added + greatest(v_delta, 0::numeric),
         lifetime_usage_charged = a.lifetime_usage_charged + greatest(-v_delta, 0::numeric)
   where a.company_id = p_company_id
   returning a.balance_amount into v_after;

  return query select 'applied'::text, v_delta, v_before, v_after;
end;
$$;

revoke execute on function public.apply_credit_movement(uuid, text, numeric, numeric, text, jsonb, numeric, uuid, uuid) from public;
revoke execute on function public.apply_credit_movement(uuid, text, numeric, numeric, text, jsonb, numeric, uuid, uuid) from anon;
revoke execute on function public.apply_credit_movement(uuid, text, numeric, numeric, text, jsonb, numeric, uuid, uuid) from authenticated;
grant execute on function public.apply_credit_movement(uuid, text, numeric, numeric, text, jsonb, numeric, uuid, uuid) to service_role;
