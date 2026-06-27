# Architecture

## High-level flow

```
  Website Chat Widget      Future Voice Agent     Future WhatsApp / Social DM
          │                        │                          │
          └────────────┬──────────┴──────────────┬───────────┘
                       ▼                          ▼
                 ┌─────────────────────────────────────┐
                 │        Channel Adapter Layer         │  normalize in/out per channel
                 └─────────────────────────────────────┘
                                   ▼
                 ┌─────────────────────────────────────┐
                 │        AI Assistant Engine           │  language, intent, tools, grounding
                 └─────────────────────────────────────┘
                                   ▼
                 ┌─────────────────────────────────────┐
                 │             Tool Layer               │  the ONLY path to business data
                 └─────────────────────────────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │  PostgreSQL + pgvector + Structured Business Tables       │
        └──────────────────────────────────────────────────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │   Shopify / WooCommerce / CSV / POS / CRM / Custom API    │
        └──────────────────────────────────────────────────────────┘
```

### The one rule that shapes everything

> **Do not put business logic in the widget.** The widget only sends/receives
> messages. The backend **AI Assistant Engine** owns all logic.

This is what makes the platform voice-ready: swapping the widget for a voice or
WhatsApp adapter changes only the **Channel Adapter Layer** — the engine, tools,
data, inbox, leads, orders, and analytics are untouched.

## Layers

### 1. Channel Adapter Layer
Translates a channel's transport into the engine's canonical message shape and
back. Web chat uses SSE for streaming + Supabase Realtime for human messages.
Each message carries `channel` and `content_type` so the same tables serve all
channels (Module 7, Module 22).

### 2. AI Assistant Engine (Module 9)
Stateless per-turn orchestrator. Responsibilities: detect language → detect
intent → decide tool calls → retrieve knowledge / search products / check orders
→ collect leads & appointment data → build cart/order → format answer → enforce
grounding ("I don't know" when context is missing) → respect AI pause / human
takeover → stream the answer.

Built on a **switchable provider abstraction** (`AIProvider`,
`EmbeddingProvider`, `RerankProvider`) selected from settings — never hardcoded.

### 3. Tool Layer (Modules 16–18)
Structured functions are the only way the model touches data. Each tool
validates input (Zod), scopes by `company_id`, and returns structured results.
Prices, stock, and order status **always** come from structured tables — the
model never invents them.

### 4. Data Layer
- **Structured tables** for products, variants, inventory, orders, customers,
  restaurant menus/modifiers (Module 15) — the source of truth for facts.
- **Vector + tsvector chunks** for documents/policies/FAQs only (Module 10).
- **Multi-tenant** via `company_id` on every tenant row + Row Level Security
  (Module 2, Module 23).

### 5. Integration Layer (Module 14)
Connectors (Shopify, WooCommerce, CSV, Custom API, POS/CRM) sync external data
into the structured tables via webhooks + **hourly reconciliation** on
Trigger.dev. Credentials are encrypted at rest.

## Settings precedence

Everything configurable resolves most-specific-first:

```
bot_settings  →  company_settings  →  platform_settings  →  env default
```

## Request lifecycles

**Visitor message (AI):**
`widget → POST /api/chat → engine: detect lang/intent → tools (RAG/products/orders)
→ stream tokens via SSE → persist message → log ai_usage`

**Human takeover (Module 11):**
`agent sends reply → conversation.ai_enabled=false, status=human_active →
Supabase Realtime delivers to widget → later visitor replies are saved & notify
the agent, AI is NOT called → agent clicks "Resume AI"`

**Hourly sync (Module 14):**
`Trigger.dev schedule → connector.sync(company, type) → upsert structured tables
→ write sync_jobs row → on failure: error log + notification`

## Security posture

Backend-only secrets, encrypted integration tokens, domain allow-listing for the
widget, per-company data isolation (RLS), customer verification before revealing
order details, backend validation before order placement, audited super-admin
impersonation, and 30-day chat retention by default. See
[Module 23](modules/module-23-privacy-security-retention.md).
