# Module 23 — Privacy, Security, and Data Retention

> **Milestone:** M9 · **Depends on:** [Module 2](./module-02-database-multitenant-settings.md), [Module 14](./module-14-integrations-hourly-sync.md) · **Status:** ✅ Implemented

## 🎯 Goal
Make the system safe and trustable: encrypt sensitive credentials, isolate tenant data, enforce access controls, log sensitive access, and retain chat data only as long as needed.

## 📦 What to build
- [ ] Encrypt integration tokens
- [ ] Domain allowlist
- [ ] Rate limiting
- [ ] Audit logs
- [ ] Company data isolation
- [ ] Export own data
- [ ] 30-day chat auto-delete setting
- [ ] Super admin raw chat access logging
- [ ] Order data verification
- [ ] No card details inside chat

## 🗄️ Database / Tables
- **Audit logs** table from [Module 2](./module-02-database-multitenant-settings.md).
- Company isolation via **RLS + `company_id`** ([Module 2](./module-02-database-multitenant-settings.md)).
- Retention setting: default chat auto-delete after 30 days, **configurable per company later**.

## 🔧 Functions / Interfaces / Events
- Encryption implemented in `src/lib/crypto.ts` — **AES-256-GCM** using `ENCRYPTION_KEY`.
- Default retention constant in `src/lib/constants.ts` — `DEFAULT_CHAT_RETENTION_DAYS = 30`.
- Domain allowlist enforced for the widget ([Module 8](./module-08-website-widget.md)).
- Scheduled cleanup job runs on **Trigger.dev** to delete old chats.
- Order verification = [Module 17](./module-17-order-details-tracking.md).
- `ADMIN_SUPPORT_ACCESS_REQUIRED` env gates super-admin impersonation.

## 📐 Rules & Constraints
- Integration credentials must be **encrypted** (AES-256-GCM, `ENCRYPTION_KEY`).
- Super admin **raw chat access must be logged**; super-admin impersonation is gated by `ADMIN_SUPPORT_ACCESS_REQUIRED`.
- A company **cannot access another company's data** (RLS + `company_id`).
- Default chat data **auto-deletes after 30 days**; per-company configuration comes later.
- **No card details** are stored or shown inside chat.
- Order data must be **verified** ([Module 17](./module-17-order-details-tracking.md)).
- The widget must respect the **domain allowlist** ([Module 8](./module-08-website-widget.md)).

## ✅ Acceptance Criteria
- [ ] Integration credentials are encrypted
- [ ] Super admin chat access is logged
- [ ] A company cannot access another company's data
- [ ] Old chats can be deleted by a scheduled job

## 🔗 Related
- [Module 2 — Database, Multi-tenant & Settings](./module-02-database-multitenant-settings.md) (RLS, `company_id`, audit logs)
- [Module 8 — Website Widget](./module-08-website-widget.md) (domain allowlist)
- [Module 14 — Integrations & Hourly Sync](./module-14-integrations-hourly-sync.md) (integration tokens)
- [Module 17 — Order Details & Tracking](./module-17-order-details-tracking.md) (order verification)
- Code: `src/lib/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`)
- Code: `src/lib/constants.ts` (`DEFAULT_CHAT_RETENTION_DAYS = 30`)
- Infra: Trigger.dev scheduled cleanup job
