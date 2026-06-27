# Module 2 — Database, Multi-Tenant Schema & Settings System

> **Milestone:** M1 · **Depends on:** [Module 1](module-01-project-foundation.md) · **Status:** ✅ Implemented

## 🎯 Goal
Create the database schema for multi-tenant companies, users, bots, and the layered settings system, plus a foundation for future channel support. Everything configurable in the platform must be driven by settings.

## 📦 What to build
- Core multi-tenant tables (companies, users, company membership)
- Roles & permissions tables
- Bots and bot settings
- Platform-level and company-level settings tables
- Audit logs
- Settings resolution helper (`src/lib/settings/index.ts`)
- Row-Level Security (RLS) for tenant isolation
- Supabase migrations under `supabase/migrations/`

## 🗄️ Database / Tables
Core tables: `users`, `companies`, `company_users`, `roles`, `permissions`, `bots`, `bot_settings`, `platform_settings`, `company_settings`, `audit_logs`.

### `companies`
| Field | Notes |
| --- | --- |
| id | PK |
| name | Company name |
| website | Company website |
| country | Country code |
| timezone | IANA timezone |
| default_language | `ar` / `en` |
| status | active / suspended |
| created_at | Timestamp |

### `company_users`
| Field | Notes |
| --- | --- |
| id | PK |
| company_id | FK → companies |
| user_id | FK → users |
| role | super_admin / company_admin / agent |
| permissions_json | Per-user permission overrides |
| created_at | Timestamp |

### `bots`
| Field | Notes |
| --- | --- |
| id | PK |
| company_id | FK → companies |
| name | Bot name |
| bot_type | Assistant type |
| system_prompt | Base system prompt |
| language_default | `ar` / `en` |
| appearance_json | Widget appearance config |
| capability_flags | Enabled capabilities |
| public_bot_id | Public ID used by the widget |
| domain_allowlist | Allowed embed domains |
| ai_enabled | Master AI toggle |
| created_at | Timestamp |

### `platform_settings`
| Field | Notes |
| --- | --- |
| id | PK |
| key | Setting key |
| value_json | Setting value |
| is_secret | Hides value in UI / logs |
| updated_by | User reference |
| updated_at | Timestamp |

### `company_settings`
| Field | Notes |
| --- | --- |
| id | PK |
| company_id | FK → companies |
| key | Setting key |
| value_json | Setting value |
| updated_by | User reference |
| updated_at | Timestamp |

Additional tables (`users`, `roles`, `permissions`, `bot_settings`, `audit_logs`) follow the same multi-tenant conventions.

## 📐 Rules & Constraints
- **Settings rule** — everything configurable comes from settings, including: AI provider; model; embedding provider; reranker; language default; widget theme; lead capture fields; appointment settings; order settings; free-trial expiry; message limits; integration sync frequency; human takeover rules; data retention; privacy settings.
- **Resolution order (most-specific-first):** `bot_settings → company_settings → platform_settings → env default`. Implemented in `src/lib/settings/index.ts`.
- Platform settings and company settings are **separate scopes**; company admins never see platform-only settings.
- `is_secret` settings must be masked in UI and excluded from logs.
- **RLS** enforces tenant isolation — a company can only read/write its own rows (cross-link [Module 23](module-23-privacy-security-retention.md)).
- The foundation extensions migration `0001_foundation_extensions.sql` already enables `pgvector`, `pg_trgm`, and `pgcrypto`.

## ✅ Acceptance Criteria
- [ ] Database migration runs cleanly
- [ ] Companies can be created
- [ ] Users can belong to a company
- [ ] Settings can be read and written
- [ ] Platform settings and company settings are stored separately

## 🔗 Related
- [Module 1 — Project Foundation](module-01-project-foundation.md)
- [Module 3 — Authentication & RBAC](module-03-auth-rbac.md) (roles/permissions consumers)
- [Module 6 — Bot / Assistant Configuration](module-06-bot-assistant-configuration.md) (bots & bot_settings)
- [Module 19 — Billing, Plans & Limits](module-19-billing-plans-limits.md) (trial / message-limit settings)
- [Module 23 — Privacy, Security & Retention](module-23-privacy-security-retention.md) (RLS, retention, secrets)
- Repo paths: `supabase/migrations/`, `supabase/migrations/0001_foundation_extensions.sql`, `src/lib/settings/index.ts`, `src/lib/db/`
