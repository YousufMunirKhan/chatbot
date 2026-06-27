# Module 22 — Voice-Ready Design

> **Milestone:** M9 · **Depends on:** [Module 7](./module-07-conversation-engine.md), [Module 9](./module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented

## 🎯 Goal
Do not build voice yet, but prepare the architecture so that adding voice later is purely additive. This module is about **preserving the abstraction**, not building voice.

## 📦 What to build
- [ ] `channel` field (on conversations/messages)
- [ ] `content_type` field (on conversations/messages)
- [ ] `response_mode` (chat | voice)
- [ ] Voice-ready message schema
- [ ] Channel adapter layer
- [ ] Reusable AI engine (shared by chat and future voice)
- [ ] Reusable tool layer
- [ ] Channel analytics
- [ ] (Optional) Prepare the future voice transcripts table

## 🗄️ Database / Tables
The `channel` and `content_type` fields already exist on **conversations/messages** ([Module 7](./module-07-conversation-engine.md)).

Prepare an **optional** future table:

### `voice_transcripts_future`
| Field | Notes |
| --- | --- |
| `id` | PK |
| `company_id` | Tenant scope |
| `conversation_id` | FK → conversations |
| `message_id` | FK → messages |
| `audio_url` | Stored audio |
| `transcript_text` | STT output |
| `stt_provider` | Speech-to-text provider |
| `tts_provider` | Text-to-speech provider |
| `confidence_score` | STT confidence |
| `created_at` | Timestamp |

## 🔧 Functions / Interfaces / Events
**Response modes** (defined in the AI engine — [Module 9](./module-09-ai-assistant-engine.md)):

- **Chat mode** → can use longer answers, product cards, links, citations.
- **Voice mode** → short answer, no markdown, ask one question at a time.

**Channel adapter layer** — adapters translate between a channel and the reusable AI engine / tool layer, so the same engine drives chat today and voice later.

## 📐 Rules & Constraints
- Website chat must use the **same engine** that future voice will use.
- Adding voice later should require **only**: a channel adapter, STT, TTS, and telephony — no rewrite of the engine or tools.
- Keep the AI engine and tool layer **reusable** across channels.
- This module preserves the abstraction; it does **not** implement voice.

## ✅ Acceptance Criteria
- [ ] Website chat uses the same engine future voice will use
- [ ] Adding voice later requires only a channel adapter, STT, TTS, and telephony

## 🔗 Related
- [Module 7 — Conversation Engine](./module-07-conversation-engine.md) (`channel` / `content_type` fields)
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) (response modes: chat | voice; reusable engine & tool layer)
