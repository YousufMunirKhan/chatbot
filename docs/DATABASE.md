# Database Schema Overview

Postgres on Supabase with `pgvector` + full-text search + Row Level Security.
Every tenant table carries `company_id` and is protected by RLS so one company
can never read another's data.

> **Golden rule:** structured business facts (products, orders, stock,
> customers, menus) live in **structured tables**. Vector chunks are only for
> documents / policies / FAQs.

## Table groups by module

### Module 2 — Core multi-tenant & settings
`users` · `companies` · `company_users` · `roles` · `permissions` · `bots` ·
`bot_settings` · `platform_settings` · `company_settings` · `audit_logs`

Key fields:
- **companies**: `id, name, website, country, timezone, default_language, status, created_at`
- **company_users**: `id, company_id, user_id, role, permissions_json, created_at`
- **bots**: `id, company_id, name, bot_type, system_prompt, language_default, appearance_json, capability_flags, public_bot_id, domain_allowlist, ai_enabled, created_at`
- **platform_settings**: `id, key, value_json, is_secret, updated_by, updated_at`
- **company_settings**: `id, company_id, key, value_json, updated_by, updated_at`

### Module 7 — Channel-agnostic conversation engine
- **conversations**: `id, company_id, bot_id, channel, status, ai_enabled, language, visitor_id, customer_id, assigned_agent_id, current_intent, state_json, started_at, closed_at, expires_at`
- **messages**: `id, company_id, conversation_id, channel, sender_type, sender_id, content_text, content_type, language, metadata_json, created_at`

Channels: `web_chat, voice, whatsapp, instagram, facebook, phone, api`.
Content types: `text, audio, image, file, system`.

### Module 10 — Knowledge base / RAG
`documents` · `document_sources` · `chunks` · `ingestion_jobs`
- **chunks**: `id, company_id, bot_id, document_id, text, contextual_text, embedding (vector), tsvector, metadata_json, created_at`

### Module 12 — Leads
- **leads**: `name, email, phone, enquiry_type, message, source_page, conversation_id, bot_id, company_id, status, created_at`

### Module 13 — Appointments
- **appointments**: `id, company_id, bot_id, conversation_id, customer_name, customer_phone, customer_email, service_type, preferred_date, preferred_time, notes, status, assigned_agent_id, created_at`
  Statuses: `requested, confirmed, cancelled, completed, no_show`.

### Module 14 — Integrations & sync
- **integration_accounts**: `id, company_id, provider, name, status, credentials_encrypted, settings_json, last_sync_at, next_sync_at, created_at`
- **sync_jobs**: `id, company_id, integration_account_id, job_type, status, started_at, finished_at, records_processed, error_message`

### Module 15 — Structured business data
`synced_products` · `synced_product_variants` · `synced_inventory` ·
`synced_orders` · `synced_order_items` · `synced_customers`

Restaurant-specific:
`restaurant_menu_items` · `restaurant_menu_variants` · `modifier_groups` ·
`modifiers` · `menu_item_modifier_groups` · `combo_groups` · `combo_options` ·
`availability_rules` · `kitchen_routing_rules`

### Module 18 — Conversational orders / cart
`chat_carts` · `chat_cart_items` · `chat_orders` · `chat_order_items` · `payments`

### Module 19 — Billing
- **subscriptions**: `id, company_id, plan, status, free_until, trial_ends_at, message_limit, agent_limit, bot_limit, integration_limit, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end`

### Module 20 — Usage / cost
- **ai_usage_logs**: `id, company_id, bot_id, conversation_id, provider, model, operation_type, input_tokens, output_tokens, estimated_cost, created_at`
  Operation types: `chat, embedding, rerank, contextualize, tool_call`.

### Module 22 — Voice-ready (prepared, not used yet)
- **voice_transcripts_future**: `id, company_id, conversation_id, message_id, audio_url, transcript_text, stt_provider, tts_provider, confidence_score, created_at`

## Conventions

- UUID PKs via `gen_random_uuid()`; timestamps `timestamptz default now()`.
- Index `company_id` on every tenant table; composite indexes for hot queries.
- RLS policies scope rows to the caller's company; the service-role client
  bypasses RLS and must filter by `company_id` in code.
- Integration credentials stored **encrypted** (`credentials_encrypted`) via
  `@/lib/crypto` (AES-256-GCM).
- Vector index: `ivfflat`/`hnsw` on `chunks.embedding`; GIN index on `tsvector`.

See [supabase/migrations/README.md](../supabase/migrations/README.md) for the
migration order.
