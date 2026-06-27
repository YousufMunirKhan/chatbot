# Module 9 — AI Assistant Engine

> **Milestone:** M3 · **Depends on:** [Module 7](module-07-conversation-engine.md), and the AI provider abstraction · **Status:** ✅ Implemented (core)

## 🧩 Implementation in this repo
- Switchable provider layer: `src/lib/ai/providers/` — `openai.ts`, `anthropic.ts` (fetch-based, streaming), `mock.ts` (works with **no API key**), and `index.ts` selector (settings/env-driven, mock fallback)
- Engine: `src/lib/ai/engine.ts` — language detection, conversation/message helpers, prompt assembly (injects RAG context), domain allow-list
- Public chat endpoint: `src/app/api/chat/route.ts` — SSE streaming, RAG retrieval, **respects AI pause / human takeover**, persists messages, CORS for the widget
- Channel-agnostic: the same engine serves the widget now and future voice/WhatsApp adapters. Business-data tools (products/orders) plug into the tool layer in Modules 16–18.
- Verified by `npm run test:chat`. _Note: AI cost logging (`ai_usage_logs`) lands in Module 20._

## 🎯 Goal
Create the central backend engine that makes **all** AI decisions for a conversation: detect language and intent, decide tool calls, retrieve knowledge, run business tools, enforce grounding, and stream the answer back. It is decoupled from any channel, so the same engine serves the widget today and a voice/WhatsApp adapter later.

## 📦 What to build
- [ ] Language detection
- [ ] Intent detection
- [ ] Tool-call decisioning
- [ ] Knowledge retrieval (RAG, [Module 10](module-10-knowledge-base-rag.md))
- [ ] Product search ([Module 16](module-16-product-stock-assistant.md))
- [ ] Order checks ([Module 17](module-17-order-details-tracking.md))
- [ ] Lead collection ([Module 12](module-12-leads-module.md))
- [ ] Appointment data collection ([Module 13](module-13-appointment-module.md))
- [ ] Cart / order creation ([Module 18](module-18-conversational-order-placement.md))
- [ ] Answer formatting
- [ ] Grounding-rule enforcement + **"I don't know"** when context is missing
- [ ] Respect AI pause / human takeover (`ai_enabled`, [Module 11](module-11-business-inbox-live-takeover.md))
- [ ] Stream the answer to the widget (SSE)
- [ ] Provider abstraction so chat/embedding/rerank providers are switchable from settings

## 🗄️ Database / Tables
None — operates over tables from [Module 7](module-07-conversation-engine.md) (`conversations`, `messages`) and reads from RAG ([Module 10](module-10-knowledge-base-rag.md)) and structured business data ([Module 15](module-15-structured-business-data.md)).

## 🔧 Tools / Interfaces / APIs

Provider interfaces are **already defined** in `src/lib/ai/types.ts`:

| Interface | Responsibility |
| --- | --- |
| `AIProvider` | Chat model: `complete(options)` and `stream(options)` |
| `EmbeddingProvider` | Multilingual embeddings (Arabic + English): `embed(texts, model)` |
| `RerankProvider` | Reranking: `rerank(query, documents, model, topK?)` |
| `ChatCompletionOptions` | `model`, `messages`, `tools?`, `temperature?`, `maxTokens?`, `stream?` |

Adapters are selected at runtime by `getChatProvider()` / `getEmbeddingProvider()` / `getRerankProvider()` based on platform/company/bot settings; defaults come from env (`DEFAULT_CHAT_PROVIDER`, etc.).

The tool layer lives in `src/lib/tools/index.ts`.

Response modes:

| Mode | Status |
| --- | --- |
| `chat` | Phase 1 (current) |
| `voice` | Future (same engine, voice adapter) |

## 📐 Rules & Constraints
- **Developer rule:** the AI provider must be **switchable, never hardcoded** — always go through the `src/lib/ai/` abstraction (OpenAI / Anthropic / Voyage / Cohere).
- The engine is **not tied to the widget** — the same engine must be callable by a future voice/WhatsApp adapter.
- Enforce **grounding**: answer only from retrieved context; say **"I don't know"** when context is missing.
- Respect `ai_enabled` — when a human has taken over, the engine pauses ([Module 11](module-11-business-inbox-live-takeover.md)).
- RAG is for documents/policies/FAQs only; products/orders/stock come from structured tools ([Module 15](module-15-structured-business-data.md)).

## ✅ Acceptance Criteria
- [ ] AI engine is **not** tied to the widget
- [ ] The same engine can be called by a future voice/WhatsApp adapter
- [ ] AI provider can be changed from settings (no code change)
- [ ] Engine streams answers and enforces "I don't know" when context is missing

## 🔗 Related
- [Module 6 — Bot/Assistant Configuration](module-06-bot-assistant-configuration.md) — supplies assembled prompt + capabilities
- [Module 7 — Conversation Engine](module-07-conversation-engine.md) — conversation/message storage
- [Module 8 — Website Widget](module-08-website-widget.md) — streaming consumer
- [Module 10 — Knowledge Base / RAG](module-10-knowledge-base-rag.md) — knowledge retrieval
- [Module 11 — Business Inbox & Live Takeover](module-11-business-inbox-live-takeover.md) — AI pause / takeover
- [Module 15 — Structured Business Data](module-15-structured-business-data.md) — products/orders/stock tools
- [Module 22 — Voice-Ready Design](module-22-voice-ready-design.md) — `voice` response mode
- Repo paths: `src/lib/ai/types.ts`, `src/lib/tools/index.ts`, `src/lib/settings/index.ts`
