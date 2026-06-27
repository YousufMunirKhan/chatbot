# Module 7 — Channel-Agnostic Conversation Engine

> **Milestone:** M3 · **Depends on:** [Module 2](module-02-database-multitenant-settings.md), [Module 6](module-06-bot-assistant-configuration.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Migration `supabase/migrations/0005_conversations.sql` — `conversations` + `messages` (channel/content-type fields, RLS, Supabase Realtime enabled)
- Engine helpers in `src/lib/ai/engine.ts` (`getOrCreateConversation`, `saveMessage`, `getRecentHistory`)
- Verified by `npm run test:chat` and `npm run test:inbox`.

## 🎯 Goal
Build the central conversation system — the backbone that stores conversations and messages independently of any one channel. It must serve website chat today and accept future voice / WhatsApp / social channels later **without a redesign**.

## 📦 What to build
- [ ] `conversations` table (channel-agnostic, multi-tenant)
- [ ] `messages` table supporting text now and audio/image/file later
- [ ] Channel-agnostic read/write layer so any adapter (web, voice, WhatsApp, …) uses the same tables
- [ ] Conversation lifecycle: open, AI-active vs human-active, close, expire
- [ ] Per-conversation `ai_enabled` flag (supports AI pause / human takeover from [Module 11](module-11-business-inbox-live-takeover.md))
- [ ] Conversation `state_json` for in-flight flow state (lead, appointment, cart, intent)
- [ ] Domain types in `src/types/index.ts`

## 🗄️ Database / Tables

### `conversations`
| Field | Notes |
| --- | --- |
| `id` | PK |
| `company_id` | Tenant scope |
| `bot_id` | Assistant used ([Module 6](module-06-bot-assistant-configuration.md)) |
| `channel` | One of `CHANNELS` |
| `status` | Lifecycle (e.g. `ai_active`, `human_active`, `closed`, `expired`) |
| `ai_enabled` | AI on/off for this conversation (human takeover) |
| `language` | `en` / `ar` / `auto` |
| `visitor_id` | Anonymous website visitor |
| `customer_id` | Known customer, if identified |
| `assigned_agent_id` | Human agent on live chat ([Module 11](module-11-business-inbox-live-takeover.md)) |
| `current_intent` | Last detected intent |
| `state_json` | In-flight flow state (lead/appointment/cart) |
| `started_at` | Open timestamp |
| `closed_at` | Close timestamp |
| `expires_at` | Retention / expiry ([Module 23](module-23-privacy-security-retention.md)) |

### `messages`
| Field | Notes |
| --- | --- |
| `id` | PK |
| `company_id` | Tenant scope |
| `conversation_id` | FK → `conversations` |
| `channel` | One of `CHANNELS` |
| `sender_type` | e.g. visitor / customer / ai / agent / system |
| `sender_id` | Sender reference |
| `content_text` | Text body |
| `content_type` | One of `CONTENT_TYPES` (`text` now; `audio` later) |
| `language` | Message language |
| `metadata_json` | Citations, tool data, attachments, etc. |
| `created_at` | Timestamp |

## 🔧 Tools / Interfaces / APIs
Enums live in `src/lib/constants.ts`:

| Constant | Values |
| --- | --- |
| `CHANNELS` | `web_chat`, `voice`, `whatsapp`, `instagram`, `facebook`, `phone`, `api` |
| `CONTENT_TYPES` | `text`, `audio`, `image`, `file`, `system` |
| `CONVERSATION_STATUS` | `ai_active`, `human_active`, `closed`, `expired` |
| `SUPPORTED_LANGUAGES` | `en`, `ar`, `auto` |

Domain types are exported from `src/types/index.ts`.

## 📐 Rules & Constraints
- The engine is **channel-agnostic** — website chat is just `channel = web_chat`; the same schema must accept `voice`, `whatsapp`, etc. without migration redesign.
- `messages.content_type` must allow non-text content (`audio`, `image`, `file`) so voice can reuse the tables later — this is what makes the platform **voice-ready** ([Module 22](module-22-voice-ready-design.md)).
- Channel and content-type values must come from the `CHANNELS` / `CONTENT_TYPES` enums in `src/lib/constants.ts`.
- All rows are tenant-scoped via `company_id` ([Module 2](module-02-database-multitenant-settings.md)).
- `ai_enabled` is the single source of truth for AI pause / human takeover.

## ✅ Acceptance Criteria
- [ ] Website chat uses `channel = web_chat`
- [ ] Future voice can use the **same tables** without redesign
- [ ] Messages can support audio later (via `content_type`)
- [ ] Conversations and messages are tenant-scoped by `company_id`

## 🔗 Related
- [Module 6 — Bot/Assistant Configuration](module-06-bot-assistant-configuration.md) — `bot_id` source
- [Module 8 — Website Widget](module-08-website-widget.md) — produces `web_chat` messages
- [Module 9 — AI Assistant Engine](module-09-ai-assistant-engine.md) — reads/writes conversations
- [Module 11 — Business Inbox & Live Takeover](module-11-business-inbox-live-takeover.md) — uses `ai_enabled` / `assigned_agent_id`
- [Module 22 — Voice-Ready Design](module-22-voice-ready-design.md) — the voice-readiness this backbone enables
- [Module 23 — Privacy, Security & Retention](module-23-privacy-security-retention.md) — `expires_at` retention
- Repo paths: `src/lib/constants.ts`, `src/types/index.ts`
