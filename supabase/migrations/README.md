# Database Migrations

SQL migrations applied to the Supabase Postgres database, in order.

> **Developer Rule:** _Every module must have clear database migrations._

| File | Module | Purpose |
| --- | --- | --- |
| `0001_foundation_extensions.sql` | 1–2 | Enable `pgvector`, `pg_trgm`, `pgcrypto` |
| `0002_core_multitenant.sql` | 2 | `users`, `companies`, `company_users`, `roles`, `permissions`, `bots`, `bot_settings`, `platform_settings`, `company_settings`, `audit_logs` + RLS |
| `0016_platform_settings_quick_actions.sql` | 16 | DB-managed platform AI/email settings foundation, contextual widget quick actions, and quick action click tracking |
| `0017_sellable_workflows.sql` | 17 | Agent invite acceptance fields, quality feedback loop, Google Calendar event tracking, platform settings audit events, realtime provider settings |
| `0018_production_scale.sql` | 18 | Optional 2FA/security logs, billing mappings/overage, agent presence/SLA, AI budgets/cache, background jobs/dead-letter, data/legal controls |
| `0019_super_admin_impersonation.sql` | 19 | Time-limited Super Admin company impersonation sessions with reason and auditability |
| `0003_auth_rbac.sql` | 3 | Link `auth.users`→`public.users`, `is_super_admin` flag + helper, super-admin RLS policies |
| `0004_subscriptions.sql` | 4 | `subscriptions` (plan/status/free-until/limits) + RLS — extended with Stripe in Module 19 |
| `0005_conversations.sql` | 7 | `conversations`, `messages` (channel-agnostic) + RLS + Realtime |
| `0006_knowledge_rag.sql` | 10 | `documents`, `document_sources`, `chunks` (vector + tsvector), `ingestion_jobs`, `match_chunks()` RPC |
| `0007_leads_appointments.sql` | 12–13–24 | `leads`, `appointments`, `notifications` + RLS |
| `0008_integrations.sql` | 14 | `integration_accounts` (encrypted creds), `sync_jobs` + RLS |
| `0009_structured_business.sql` | 15 | `synced_products`/variants/inventory/orders/customers + full restaurant menu model + RLS |
| `0010_cart_orders.sql` | 18 | `chat_carts`, `chat_cart_items`, `chat_orders`, `chat_order_items`, `payments` + RLS |
| `0011_usage_logs.sql` | 20 | `ai_usage_logs` + RLS |
| `0012_voice_privacy.sql` | 22–23 | `voice_transcripts_future`, `admin_access_logs`, `cleanup_old_chats()` retention fn |
| `0013_evaluations.sql` | 25 | `eval_questions`, `eval_runs` + RLS |
| `0014_business_memory.sql` | 5/6/10 | Structured business profile, locations, hours, services, policies, FAQs + RLS |
| `0015_realtime_quality_agents.sql` | 11/20/25 | Company slugs, agent invites, `needs_human`, answer quality logs + RLS |
| `0027_helpdesk_connectors.sql` | Help Desk | Connector registry, reviewed software docs, action manifests, and connector event logs |
| `0028_helpdesk_connector_revisions.sql` | Help Desk | Connector manifest revision/resync tracking for installed SDKs |

> Stripe (Module 19) reuses the `subscriptions` columns from `0004` — no extra
> migration; the checkout/webhook routes live in `src/app/api/billing` & `…/webhooks/stripe`.

## Running migrations

**This repo's runner (recommended):** applies every `*.sql` here in order and
tracks applied files in `public._migrations` (idempotent — safe to re-run).

```bash
# Requires DATABASE_URL in .env.local (Settings → Database → Connection string → URI)
npm run db:migrate
```

**Supabase CLI:**

```bash
supabase db push          # apply pending migrations to the linked project
supabase migration new <name>   # scaffold a new migration file
```

**Manual:** paste the SQL into the Supabase Dashboard → SQL Editor, in order.

## Conventions

- UUID primary keys via `gen_random_uuid()`.
- Every tenant table has `company_id uuid not null` and an index on it.
- Enable **Row Level Security** on tenant tables; policies scope rows to the
  caller's company (Module 23). The service-role client bypasses RLS and must
  scope by `company_id` manually.
- Timestamps are `timestamptz default now()`.
