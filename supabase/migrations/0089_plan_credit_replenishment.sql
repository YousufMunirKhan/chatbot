-- ===========================================================================
-- Migration 0089 — The included credit could never fund the replies it sold
--
-- Three gates stand in front of a widget reply (src/app/api/chat/route.ts): the
-- plan's monthly reply count, the company's own USD budget stop, and the prepaid
-- wallet in `company_credit_accounts`, which allows a reply only while the
-- balance is above zero. All three are deliberate. Two of them reset. The
-- wallet did not.
--
-- Included credit was granted exactly once, when the company was provisioned,
-- and every reply deducted from it at the customer rate (provider USD x 0.8 FX
-- x 2.5 markup). At today's measured cost that is £0.0121 a reply on the
-- standard model, so Starter's £5 of included credit funded about 412 of the 500
-- replies the package advertises — once, ever. From month two the balance was £0
-- and the assistant was silent, on a customer who was still being charged £19
-- and still had their full reply allowance untouched. Every paid package had
-- that shape, and nothing on any screen explained it.
--
-- Two halves to the repair, and this migration is the database half:
--
--   1. `replenishMonthlyCredit` (src/lib/billing/credits.ts) tops a company's
--      wallet back UP TO its plan's included credit, once per UTC month. The
--      unique index below is what makes that safe to call from anywhere,
--      including on a request path: the `included_credit` ledger row IS the
--      lock, so two callers racing on the 1st cannot both grant, and — unlike a
--      flag on the account — the lock is restored with the balance it explains
--      when a backup is replayed.
--
--   2. The included figures themselves were arbitrary. They are now derived:
--      the advertised reply count x what that reply costs the wallet on the
--      highest model tier the plan may reach, +15% headroom, rounded up. The
--      derivation is written out above the `PLANS` map in
--      src/modules/super-admin/plans.ts, and both places must be changed
--      together — `billing_plans` is what the public pricing page reads, and
--      the map is what provisioning copies onto a new subscription. Two
--      catalogues that disagree is how a customer is sold one thing and
--      provisioned another.
--
-- Starter also gains its first integration. A £19 assistant that cannot look up
-- the order a customer is asking about is a demo, not a product; the owner asked
-- for this. The subscription backfill at the bottom moves only rows that still
-- carry the old plan default, so a limit an operator set by hand is left alone.
--
-- No index is added for the reply-grant window change (grants now apply to the
-- window they were made in, and a carried grant's spend is derived from usage):
-- the count it runs is bounded by (company_id, created_at), which
-- `idx_ai_usage_company_created` from migration 0011 already covers.
-- ===========================================================================

-- One included-credit grant per company per calendar month, enforced rather
-- than merely intended. `created_at at time zone 'UTC'` keeps the expression
-- immutable, which a bare `date_trunc` on a timestamptz is not — it would depend
-- on the session's TimeZone and could not be indexed.
create unique index if not exists uq_credit_included_per_month
  on public.company_credit_transactions (
    company_id,
    (date_trunc('month', created_at at time zone 'UTC'))
  )
  where type = 'included_credit';

-- The catalogue the pricing page reads. Figures derived in plans.ts:
--   free_trial  100 replies x £0.01212 (standard) = £1.21  -> £2
--   starter     500 replies x £0.01212 (standard) = £6.06  -> £7
--   growth     2000 replies x £0.04200 (premium)  = £84.00 -> £97
--   pro        5000 replies x £0.04200 (premium)  = £210   -> £242
-- (+15% headroom, rounded up to the pound.)
update public.billing_plans set included_credit_gbp = 2,   updated_at = now() where key = 'free_trial';
update public.billing_plans set included_credit_gbp = 7,   updated_at = now() where key = 'starter';
update public.billing_plans set included_credit_gbp = 97,  updated_at = now() where key = 'growth';
update public.billing_plans set included_credit_gbp = 242, updated_at = now() where key = 'pro';

update public.billing_plans
   set integration_limit = 1,
       updated_at = now()
 where key = 'starter'
   and coalesce(integration_limit, 0) = 0;

-- Existing Starter subscriptions carry a copy of the old limit, taken at
-- provisioning. Only the rows that still hold the old default are moved: a 0 an
-- operator chose deliberately for one company is indistinguishable from this
-- one, and there is no such company today, but blanket-writing every row would
-- silently overrule that decision the first time there is.
update public.subscriptions
   set integration_limit = 1,
       updated_at = now()
 where plan = 'starter'
   and integration_limit = 0;
