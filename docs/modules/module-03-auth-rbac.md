# Module 3 — Authentication & Role-Based Access

> **Milestone:** M1 · **Depends on:** [Module 2](module-02-database-multitenant-settings.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Migration: `supabase/migrations/0003_auth_rbac.sql` (auth.users→users trigger, `is_super_admin` flag + helper, super-admin RLS policies)
- Server auth helpers: `src/lib/auth/index.ts` (`getSessionUser`, `requireUser`, `requireRole`, `assertRole`, `homePathFor`)
- Session middleware + route protection: `src/middleware.ts`
- Login flow: `src/app/(auth)/login/` (form + optional Google), server actions in `src/app/(auth)/actions.ts`, OAuth callback `src/app/(auth)/auth/callback/route.ts`
- Role-based shell + guards: `src/app/(dashboard)/layout.tsx`, `super-admin/layout.tsx`, `company/layout.tsx`
- Bootstrap & verify: `npm run seed:admin -- <email> <password>`, `npm run test:auth`

## 🎯 Goal
Add login and role-based access control on top of Supabase Auth, with protected routes and role-aware navigation for super admins, company admins, and agents.

## 📦 What to build
- Email/password login (or auth provider integration)
- Optional Google login
- Protected routes
- Role-based navigation
- Super admin access path
- Company admin access path
- Agent access path
- Guard helpers (`src/lib/auth/index.ts`)

## 🗄️ Database / Tables
None new — uses `users`, `company_users`, `roles`, and `permissions` from [Module 2](module-02-database-multitenant-settings.md). Roles are also defined in `src/lib/constants.ts`: `super_admin`, `company_admin`, `agent`.

## 🧭 Pages / Routes
| Route group | Purpose |
| --- | --- |
| `src/app/(auth)/` | Login / sign-in pages |
| `src/app/(dashboard)/` | Guarded behind authentication |

## 📐 Rules & Constraints
- **Super admin** can access all platform data across every tenant.
- **Company admin** can only access their own company's data.
- **Agent** can only access permitted conversations.
- Unauthorized access is blocked at the route/guard level.
- Built on **Supabase Auth**; session and role checks run through `src/lib/auth/index.ts` guard helpers (currently stubbed).
- Role definitions are the single source in `src/lib/constants.ts`.
- Navigation menus render per role — no super-admin-only menu items leak to lower roles.

## ✅ Acceptance Criteria
- [ ] Super admin logs in
- [ ] Company admin logs in
- [ ] Agent logs in
- [ ] Role-based menus work
- [ ] Unauthorized access is blocked

## 🔗 Related
- [Module 2 — Database, Multi-Tenant Schema & Settings](module-02-database-multitenant-settings.md) (roles, permissions, company_users)
- [Module 4 — Super Admin Dashboard](module-04-super-admin-dashboard.md) (super_admin surface)
- [Module 5 — Company Admin Dashboard](module-05-company-admin-dashboard.md) (company_admin surface)
- [Module 11 — Business Inbox & Live Takeover](module-11-business-inbox-live-takeover.md) (agent conversation permissions)
- [Module 23 — Privacy, Security & Retention](module-23-privacy-security-retention.md) (RLS pairing)
- Repo paths: `src/lib/auth/index.ts`, `src/lib/constants.ts`, `src/app/(auth)/`, `src/app/(dashboard)/`
