# Module 25 — Testing and Evaluation Harness

> **Milestone:** M9 · **Depends on:** [Module 10](./module-10-knowledge-base-rag.md), [Module 16](./module-16-product-stock-assistant.md), [Module 17](./module-17-order-details-tracking.md), [Module 18](./module-18-conversational-order-placement.md) (and [Module 21](./module-21-arabic-english-rtl.md)) · **Status:** ✅ Implemented

## 🎯 Goal
Test quality and prevent regressions. Provide an evaluation harness so each bot can be checked against sample questions, with failed retrievals surfaced.

## 📦 What to build
- [ ] Test set: **RAG retrieval**
- [ ] Test set: **Arabic retrieval**
- [ ] Test set: **English retrieval**
- [ ] Test set: **Arabizi**
- [ ] Test set: **order lookup**
- [ ] Test set: **product lookup**
- [ ] Test set: **restaurant modifiers**
- [ ] Test set: **lead capture**
- [ ] Test set: **appointment booking**
- [ ] Test set: **order placement**
- [ ] Test set: **human takeover**
- [ ] Test set: **billing limits**
- [ ] Test set: **domain allowlist**
- [ ] Evaluation runnable from an admin/developer command (script/command)

## 🗄️ Database / Tables
None specified — evaluation is driven by per-bot sample questions (see schema below).

## 🔧 Functions / Interfaces / Events
**Evaluation** — each bot can have sample questions with fields:

| Field | Notes |
| --- | --- |
| `question` | The test question |
| `expected_source` | Where the answer should come from |
| `expected_answer_type` | Type of expected answer |
| `language` | Question language (en / ar / arabizi / mixed) |
| `must_not_answer_if_missing` | Enforce the "I don't know" grounding rule |

Evaluation is **runnable via a script/command** and can be triggered from an admin/developer command.

## 📐 Rules & Constraints
- Ties directly to [Module 21](./module-21-arabic-english-rtl.md): **Arabic/English must be tested, not just translated**.
- Enforce the grounding / **"I don't know"** rule from [Module 9](./module-09-ai-assistant-engine.md) / [Module 10](./module-10-knowledge-base-rag.md) via `must_not_answer_if_missing`.
- Results must **show failed retrievals**.
- **Arabic tests** must be included.

## ✅ Acceptance Criteria
- [ ] Evaluation can be run from an admin/developer command
- [ ] Results show failed retrievals
- [ ] Arabic tests are included

## 🔗 Related
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) (grounding / "I don't know")
- [Module 10 — Knowledge Base / RAG](./module-10-knowledge-base-rag.md) (retrieval, grounding)
- [Module 16 — Product / Stock Assistant](./module-16-product-stock-assistant.md) (product lookup, restaurant modifiers)
- [Module 17 — Order Details & Tracking](./module-17-order-details-tracking.md) (order lookup)
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md) (order placement)
- [Module 21 — Arabic + English + RTL](./module-21-arabic-english-rtl.md) (Arabic/English must be tested)
