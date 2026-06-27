# Module 4 — Super Admin Dashboard

> **Milestone:** M2 · **Depends on:** [Module 3](module-03-auth-rbac.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Migration: `supabase/migrations/0004_subscriptions.sql` (`subscriptions` table + RLS; Stripe layered in Module 19)
- Data layer (service-role, super-admin only): `src/modules/super-admin/data.ts`
- Server actions: `src/modules/super-admin/actions.ts` (`createCompanyAction` onboards company + subscription + admin login + audit; `setCompanyStatusAction`; `updateSubscriptionAction`)
- Plans catalogue: `src/modules/super-admin/plans.ts`
- Pages (guarded by `super-admin/layout.tsx`): `/super-admin` (overview), `/companies`, `/companies/new`, `/companies/[id]`, `/subscriptions`, `/usage`, `/costs`, `/profit`, `/integrations`, `/audit-logs`
- Verify: `npm run test:onboarding`
- Note: usage/AI-cost columns read live once Module 20 ships; revenue is derived from assigned plans now.

## 🎯 Goal
Give the platform owner a dashboard to onboard and manage companies end-to-end — including plans, trials, message limits, and visibility into usage, AI cost, revenue, and profit.

## 📦 What to build
Super admin can:
- Create a company
- Create a company admin
- Set status (active / suspended)
- Assign a plan
- Set a free-until (trial expiry) date
- Set message limits
- View bots
- View integrations
- View sync status
- View usage
- View AI cost
- View revenue
- View profit / loss

## 🗄️ Database / Tables
None new — reads/writes tables from [Module 2](module-02-database-multitenant-settings.md) (`companies`, `company_users`, `bots`, `platform_settings`, `company_settings`, `audit_logs`). Revenue/cost/profit figures are derived from [Module 19](module-19-billing-plans-limits.md) (billing) and [Module 20](module-20-usage-cost-revenue-profit.md) (usage logs).

## 🧭 Pages / Routes
| Route | Purpose |
| --- | --- |
| `/super-admin` | Overview / home |
| `/super-admin/companies` | Company list |
| `/super-admin/companies/new` | Onboard a new company |
| `/super-admin/companies/[id]` | Company detail & management |
| `/super-admin/subscriptions` | Plans & subscriptions |
| `/super-admin/usage` | Usage across tenants |
| `/super-admin/costs` | AI / infra cost |
| `/super-admin/profit` | Profit / loss |
| `/super-admin/integrations` | Integrations & sync status |
| `/super-admin/audit-logs` | Audit trail |

## 📐 Rules & Constraints
- Restricted to the **super_admin** role (see [Module 3](module-03-auth-rbac.md)).
- Super admin can read across **all** tenants.
- Trial / free-until date and message limits are stored as settings ([Module 2](module-02-database-multitenant-settings.md)) and enforced by billing ([Module 19](module-19-billing-plans-limits.md)).
- Cost/revenue/profit are read-only views aggregated from billing + usage logs, not entered manually.

## ✅ Acceptance Criteria
- [ ] Super admin can onboard a business fully
- [ ] Super admin can set a trial / free-expiry date
- [ ] Super admin can see company cost, revenue, and profit

## 🔗 Related
- [Module 3 — Authentication & RBAC](module-03-auth-rbac.md)
- [Module 5 — Company Admin Dashboard](module-05-company-admin-dashboard.md) (the tenant-side counterpart)
- [Module 14 — Integrations & Hourly Sync](module-14-integrations-hourly-sync.md) (sync status)
- [Module 19 — Billing, Plans & Limits](module-19-billing-plans-limits.md) (plans, trials, limits, revenue)
- [Module 20 — Usage, Cost, Revenue & Profit](module-20-usage-cost-revenue-profit.md) (cost & profit data)
- Repo paths: `src/modules/super-admin/`, `src/app/(dashboard)/super-admin/`
