# Module 14 — Integrations and Hourly Sync

> **Milestone:** M6 · **Depends on:** [Module 2](./module-02-database-multitenant-settings.md) (and crypto from [Module 23](./module-23-privacy-security-retention.md) for token encryption) · **Status:** ✅ Implemented

## 🎯 Goal
Sync external business data (products, orders, customers, inventory) from third-party sources into structured tables, using webhooks where available and hourly sync as a backup/reconciliation mechanism.

## 📦 What to build
Build connectors in this order: **CSV → WooCommerce → Shopify → Custom API → POS/CRM.**

- [ ] `integration_accounts` and `sync_jobs` tables
- [ ] Connector implementations behind a shared `IntegrationConnector` interface
- [ ] Webhook handlers where the provider supports them
- [ ] Hourly sync job (backup/reconciliation) on Trigger.dev with retries
- [ ] Manual resync button
- [ ] Sync error logs surfaced in the UI
- [ ] Credentials encrypted at rest via `src/lib/crypto.ts`

## 🗄️ Database / Tables
**`integration_accounts`:**

| Field | Notes |
|---|---|
| `id` | Primary key |
| `company_id` | Tenant owner |
| `provider` | e.g. shopify, woocommerce, csv, custom_api, pos, crm |
| `name` | Account display name |
| `status` | Connection status |
| `credentials_encrypted` | Encrypted credentials (via `src/lib/crypto.ts`) |
| `settings_json` | Provider-specific settings / field mapping |
| `last_sync_at` | Last successful sync |
| `next_sync_at` | Next scheduled sync |
| `created_at` | Creation timestamp |

**`sync_jobs`:**

| Field | Notes |
|---|---|
| `id` | Primary key |
| `company_id` | Tenant owner |
| `integration_account_id` | FK → `integration_accounts` |
| `job_type` | Sync job type (`SyncJobType`) |
| `status` | Job status |
| `started_at` | Start time |
| `finished_at` | Finish time |
| `records_processed` | Count of processed records |
| `error_message` | Populated on failure |

## 🔧 Tools / Interfaces / Flow
Connector interface lives in `src/lib/integrations/index.ts`: `IntegrationConnector`, `SyncJobType`, `SyncResult`.

**Sync strategy:**
- Webhooks where available (real-time updates)
- Hourly sync as backup/reconciliation (Trigger.dev, with retries)
- Manual resync button
- Sync error logs

**Providers:**

| Provider | Auth | Capabilities |
|---|---|---|
| **CSV** | Upload | Uploads for products, restaurant menus, orders, customers, inventory; mapping UI |
| **WooCommerce** | API key/secret | Products, orders, customers, stock sync; webhooks |
| **Shopify** | OAuth | GraphQL Admin API; products, variants, inventory, orders, customers sync; draft order creation; webhooks |
| **Custom API** | Base URL + bearer token/API key | Products, orders, customers, inventory endpoints; JSON field mapping; sync frequency |
| **POS/CRM** | API connector or CSV | Phase 1: API connector if POS/CRM has an API; CSV import if no API; optional read-only sync agent planned for desktop/local POS |

**Flow:**
```
Provider webhook fires  →  connector handles event  →  upsert into structured tables (Module 15)

Hourly (Trigger.dev)  →  create sync_job  →  connector.sync() → SyncResult
  → upsert into structured tables (Module 15)
  → update records_processed, last_sync_at, next_sync_at
  → on failure: write error_message, retry
```

**Webhook env secrets:** `SHOPIFY_*`, `WOOCOMMERCE_WEBHOOK_SECRET`.

## 📐 Rules & Constraints
- Credentials must be stored encrypted (`credentials_encrypted`) via `src/lib/crypto.ts` — never in plaintext.
- Hourly jobs and retries run on Trigger.dev.
- Webhooks are primary where available; hourly sync is backup/reconciliation.
- Build connectors in order: CSV → WooCommerce → Shopify → Custom API → POS/CRM.
- Synced data lands in the structured tables defined in [Module 15](./module-15-structured-business-data.md).
- Every sync attempt is recorded in `sync_jobs`; failures must capture `error_message`.

## ✅ Acceptance Criteria
- [ ] CSV products/orders import works
- [ ] WooCommerce sync works
- [ ] Shopify sync works
- [ ] Sync runs hourly
- [ ] Sync logs are visible
- [ ] Failed sync shows an error

## 🔗 Related
- [Module 2 — Database, Multi-tenant & Settings](./module-02-database-multitenant-settings.md) — tenant scoping
- [Module 15 — Structured Business Data](./module-15-structured-business-data.md) — destination structured tables
- [Module 23 — Privacy, Security & Retention](./module-23-privacy-security-retention.md) — credential encryption (`src/lib/crypto.ts`)
- [Module 16 — Product & Stock Assistant](./module-16-product-stock-assistant.md) — consumes synced data
- [Module 17 — Order Details & Tracking](./module-17-order-details-tracking.md) — consumes synced orders
- Code: `src/lib/integrations/index.ts` (`IntegrationConnector`, `SyncJobType`, `SyncResult`), `src/lib/crypto.ts`
