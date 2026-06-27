# Module 5 — Company Admin Dashboard

> **Milestone:** M2 · **Depends on:** [Module 3](module-03-auth-rbac.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Company-scoped data layer (bound to the session user's own `companyId`): `src/modules/company/data.ts`
- Server actions (guarded `company_admin`): `src/modules/company/actions.ts` — `updateProfileAction`, `createBotAction` (+ bot-limit enforcement), `updateBotAction`, `inviteAgentAction`, `removeAgentAction`
- Functional pages: `/company` (overview), `/profile`, `/bots`, `/bots/new`, `/bots/[id]/settings` (with embed snippet), `/agents` (invite/remove), `/widget`, `/usage`, `/billing`
- Placeholder pages (owned by later modules): `/knowledge` (10), `/integrations` (14), `/inbox` (11), `/leads` (12), `/appointments` (13), `/orders` (17–18)
- Reusable UI: `ModulePlaceholder`, `CopyButton`, plus `card`/`table`/`badge` primitives
- Verify: `npm run test:company`
- Note: assistant creation here covers type + capabilities + appearance; prompt-template assembly is Module 6. Usage counters go live with Module 20; Stripe self-service billing with Module 19.

## 🎯 Goal
Create the company-facing dashboard where a company admin configures their full AI assistant — profile, bots, knowledge, integrations, inbox, leads, appointments, orders, team, widget, usage, and billing.

## 📦 What to build
Company admin can:
- Update business profile
- Create a bot / assistant
- Choose assistant capabilities
- Train the knowledge base
- Connect integrations
- View the inbox
- Manage leads
- View appointments
- Manage orders
- Manage team / agents
- Configure the widget
- View usage
- Manage billing

## 🗄️ Database / Tables
None new — reads/writes tables from [Module 2](module-02-database-multitenant-settings.md) (`companies`, `company_users`, `bots`, `bot_settings`, `company_settings`) scoped to the current tenant. Each feature area is backed by its dedicated module's tables.

## 🧭 Pages / Routes
| Route | Purpose | Fleshed out by |
| --- | --- | --- |
| `/company` | Dashboard home | — |
| `/company/profile` | Business profile | — |
| `/company/bots` | Bot list | [Module 6](module-06-bot-assistant-configuration.md) |
| `/company/bots/new` | Create a bot | [Module 6](module-06-bot-assistant-configuration.md) |
| `/company/bots/[id]/settings` | Bot settings | [Module 6](module-06-bot-assistant-configuration.md) |
| `/company/knowledge` | Knowledge base | [Module 10](module-10-knowledge-base-rag.md) |
| `/company/integrations` | Integrations | [Module 14](module-14-integrations-hourly-sync.md) |
| `/company/inbox` | Inbox | [Module 11](module-11-business-inbox-live-takeover.md) |
| `/company/leads` | Leads | [Module 12](module-12-leads-module.md) |
| `/company/appointments` | Appointments | [Module 13](module-13-appointment-module.md) |
| `/company/orders` | Orders | [Modules 17](module-17-order-details-tracking.md) / [18](module-18-conversational-order-placement.md) |
| `/company/agents` | Team / agents | — |
| `/company/widget` | Widget config | [Module 8](module-08-website-widget.md) |
| `/company/usage` | Usage | [Module 20](module-20-usage-cost-revenue-profit.md) |
| `/company/billing` | Billing | [Module 19](module-19-billing-plans-limits.md) |

## 📐 Rules & Constraints
- Restricted to the **company_admin** role (see [Module 3](module-03-auth-rbac.md)).
- All data is **scoped to the admin's own company** — no cross-tenant access.
- **No super-admin-only data** (platform costs/profit, other companies) is visible here.
- Each route is a shell here; its behavior is implemented by the linked dedicated module.

## ✅ Acceptance Criteria
- [ ] Company admin can configure a full assistant from the dashboard
- [ ] No super-admin-only data is visible to the company admin

## 🔗 Related
- [Module 3 — Authentication & RBAC](module-03-auth-rbac.md)
- [Module 4 — Super Admin Dashboard](module-04-super-admin-dashboard.md) (platform-owner counterpart)
- [Module 6 — Bot / Assistant Configuration](module-06-bot-assistant-configuration.md)
- [Module 8 — Website Widget](module-08-website-widget.md)
- [Module 10 — Knowledge Base & RAG](module-10-knowledge-base-rag.md)
- [Module 11 — Business Inbox & Live Takeover](module-11-business-inbox-live-takeover.md)
- [Module 12 — Leads](module-12-leads-module.md)
- [Module 13 — Appointments](module-13-appointment-module.md)
- [Module 14 — Integrations & Hourly Sync](module-14-integrations-hourly-sync.md)
- [Module 17 — Order Details & Tracking](module-17-order-details-tracking.md) · [Module 18 — Conversational Order Placement](module-18-conversational-order-placement.md)
- [Module 19 — Billing, Plans & Limits](module-19-billing-plans-limits.md) · [Module 20 — Usage, Cost, Revenue & Profit](module-20-usage-cost-revenue-profit.md)
- Repo paths: `src/modules/company/`, `src/app/(dashboard)/company/`
