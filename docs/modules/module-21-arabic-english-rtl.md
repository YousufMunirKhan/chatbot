# Module 21 — Arabic + English + RTL

> **Milestone:** M4 (partial; cross-cutting) · **Depends on:** [Module 8](./module-08-website-widget.md), [Module 9](./module-09-ai-assistant-engine.md), [Module 10](./module-10-knowledge-base-rag.md) · **Status:** ✅ Implemented

## 🎯 Goal
Full bilingual support across the product: the assistant understands and replies in the user's language (English, Arabic, Gulf dialect, Arabizi, and mixed Arabic/English), and the widget and UI render correctly in both LTR and RTL.

## 📦 What to build
- [ ] Support **English** input and answers
- [ ] Support **Arabic** input and answers
- [ ] Support **Gulf dialect** input (answer in Arabic)
- [ ] Support **Arabizi** input (Latin-script Arabic; answer in Arabic)
- [ ] Support **mixed Arabic/English** input with a natural response
- [ ] **RTL widget** layout
- [ ] **Arabic UI strings** and **English UI strings**
- [ ] **Arabic prompt templates** and **English prompt templates** (from [Module 6](./module-06-bot-assistant-configuration.md))
- [ ] Centralize language handling helpers (see below)
- [ ] Widget config for `language_default` and `direction`

## 🗄️ Database / Tables
None — cross-cutting. Language behavior is driven by config and helpers; prompt templates come from [Module 6](./module-06-bot-assistant-configuration.md); multilingual embeddings/rerank from [Module 9](./module-09-ai-assistant-engine.md) / [Module 10](./module-10-knowledge-base-rag.md).

## 🔧 Functions / Interfaces / Events
Centralize language handling:

- `detect_language(text)` — detect the input language
- `normalize_arabic(text)` — normalize Arabic text
- `detect_arabizi(text)` — detect Latin-script (Arabizi) Arabic
- `respond_in_same_language(...)` — reply in the user's language

Widget configuration:

- `language_default = en | ar | auto`
- `direction = ltr | rtl | auto`

Constants & hooks:

- Language enum in `src/lib/constants.ts` — `SUPPORTED_LANGUAGES = en | ar | auto`
- RTL CSS hook in `src/app/globals.css` — `[dir='rtl']`

## 📐 Rules & Constraints
- The assistant must **respond in the same language** as the user.
- Gulf dialect and Arabizi questions should be answered in **Arabic**.
- Mixed Arabic/English input should get a **natural** response.
- Cross-language retrieval must work: English docs + Arabic question → correct answer, and Arabic docs + English question → correct answer (relies on multilingual embeddings/rerank from [Module 9](./module-09-ai-assistant-engine.md) / [Module 10](./module-10-knowledge-base-rag.md)).
- When data is missing, answer **"I don't know"** (grounding rule from [Module 9](./module-09-ai-assistant-engine.md) / [Module 10](./module-10-knowledge-base-rag.md)).
- **Developer rule:** Arabic/English support must be **TESTED, not just translated** — tie into [Module 25](./module-25-testing-evaluation-harness.md).

## ✅ Acceptance Criteria
- [ ] English question → English answer
- [ ] Arabic question → Arabic answer
- [ ] Gulf dialect question → Arabic answer
- [ ] Arabizi question → Arabic answer
- [ ] Mixed Arabic/English → natural response
- [ ] English docs + Arabic question → correct answer
- [ ] Arabic docs + English question → correct answer
- [ ] Missing data → "I don't know"
- [ ] RTL mobile widget works

## 🔗 Related
- [Module 6 — Bot/Assistant Configuration](./module-06-bot-assistant-configuration.md) (prompt templates)
- [Module 8 — Website Widget](./module-08-website-widget.md)
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md)
- [Module 10 — Knowledge Base / RAG](./module-10-knowledge-base-rag.md)
- [Module 25 — Testing & Evaluation Harness](./module-25-testing-evaluation-harness.md)
- Code: `src/lib/constants.ts` (`SUPPORTED_LANGUAGES`)
- Code: `src/app/globals.css` (`[dir='rtl']`)
