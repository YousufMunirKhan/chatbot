# Module 19 — Billing, Plans & Limits

> **Milestone:** M8 · **Depends on:** [Module 2 — Database, Multi-tenant & Settings](./module-02-database-multitenant-settings.md) · **Status:** ✅ Implemented

## 🎯 Goal
Allow SaaS subscription billing and backend usage enforcement, so plan limits are checked before costly actions and Stripe keeps subscription state in sync.

## 📦 What to build
- [ ] Plans (Free Trial, Starter, Growth, Pro, Custom)
- [ ] `subscriptions` table
- [ ] Stripe subscription integration
- [ ] Stripe webhook handler that updates subscription state
- [ ] Backend enforcement helper that blocks actions over plan limits
- [ ] Super admin overrides (free-until, custom limits, manual status, suspend)

## 🗄️ Database / Tables
**`subscriptions`**

| Field | Notes |
| --- | --- |
| `id` | Primary key |
| `company_id` | Tenant |
| `plan` | Free Trial / Starter / Growth / Pro / Custom |
| `status` | Subscription status |
| `free_until` | Super-admin free-until override date |
| `trial_ends_at` | Trial expiry |
| `message_limit` | Allowed AI messages |
| `agent_limit` | Allowed agents |
| `bot_limit` | Allowed bots |
| `integration_limit` | Allowed integrations |
| `stripe_customer_id` | Stripe customer reference |
| `stripe_subscription_id` | Stripe subscription reference |
| `current_period_start` | Billing period start |
| `current_period_end` | Billing period end |

## 🔧 Tools / Functions / Flow
- Enforcement helper stubbed in `src/lib/billing/index.ts` (`assertWithinPlan`, `LimitedAction`).
- Stripe webhook endpoint: `/api/webhooks/stripe`.

Backend enforcement — check limits before:

- AI message
- bot creation
- integration creation
- agent creation
- order placement (if plan disallows)
- embedding / ingestion (if over limit)

Super admin overrides — super admin can set:

- free-until date
- custom message limit
- custom bot limit
- custom integration limit
- manual subscription status
- suspended status

Stripe environment variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

## 📐 Rules & Constraints
- Limits must be enforced on the backend before the action runs, not just in the UI.
- Super admin overrides take precedence (free-until, custom limits, manual / suspended status).
- Super-admin overrides are surfaced in [Module 4 — Super Admin Dashboard](./module-04-super-admin-dashboard.md).

## ✅ Acceptance Criteria
- [ ] Stripe subscription works.
- [ ] The webhook updates the subscription.
- [ ] Message limits are enforced.
- [ ] The super admin free-until override works.

## 🔗 Related
- [Module 2 — Database, Multi-tenant & Settings](./module-02-database-multitenant-settings.md)
- [Module 4 — Super Admin Dashboard](./module-04-super-admin-dashboard.md) (overrides surfaced here)
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md) (order placement enforcement, payment links)
- [Module 20 — Usage, AI Cost, Revenue & Profit Dashboard](./module-20-usage-cost-revenue-profit.md) (revenue = subscriptions)
- Repo code paths: `src/lib/billing/index.ts`, `/api/webhooks/stripe`
