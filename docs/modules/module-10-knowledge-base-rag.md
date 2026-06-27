# Module 10 — Knowledge Base Training / RAG

> **Milestone:** M4 · **Depends on:** [Module 9](module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented (text sources)

## 🧩 Implementation in this repo
- Migration `supabase/migrations/0006_knowledge_rag.sql` — `documents`, `document_sources`, `chunks` (`vector(1536)` + generated `tsvector`), `ingestion_jobs`, and the `match_chunks()` hybrid-retrieval RPC
- Ingestion: `src/lib/ai/ingest.ts` — chunk → embed → store (mock or OpenAI embeddings)
- Retrieval: `src/lib/ai/rag.ts` — `retrieveContext()` blends vector similarity + keyword rank; injected into the prompt with grounding ("I don't know" when missing)
- Company UI: `/company/knowledge` — add text sources, list documents
- Verified by `npm run test:chat` (RAG → answer). _Note: pasted text + TXT now; PDF/DOCX/CSV/website-crawl extraction to follow._

## 🎯 Goal
Let a company train its assistant from business data. Ingest documents, FAQs, policies, and crawled website pages into a vector + keyword index, then retrieve the most relevant chunks at answer time so the assistant is grounded — and says **"I don't know"** when nothing relevant is found.

## 📦 What to build
- [ ] Source ingestion for: pasted text, website pages (crawl), PDF, DOCX, TXT, FAQ entries, policies, CSV knowledge rows
- [ ] Ingestion pipeline: upload/crawl → text extraction → chunking → contextualization → embedding → store
- [ ] Multilingual embeddings + reranking (Arabic + English, configurable via [Module 9](module-09-ai-assistant-engine.md))
- [ ] Hybrid retrieval: vector + keyword + merge + rerank, returning **top 3–6 chunks**
- [ ] Citations / source references on answers
- [ ] Background ingestion jobs on Trigger.dev

## 🗄️ Database / Tables
Tables: `documents`, `document_sources`, `chunks`, `ingestion_jobs`.

### `chunks`
| Field | Notes |
| --- | --- |
| `id` | PK |
| `company_id` | Tenant scope |
| `bot_id` | Owning assistant ([Module 6](module-06-bot-assistant-configuration.md)) |
| `document_id` | FK → `documents` |
| `text` | Raw chunk text |
| `contextual_text` | Contextualized chunk text (for retrieval) |
| `embedding` | pgvector embedding |
| `tsvector` | Keyword index for full-text search |
| `metadata_json` | Source refs / citations metadata |
| `created_at` | Timestamp |

Uploaded files go to **Supabase Storage**; extracted text is stored in the DB.

## 🔧 Tools / Interfaces / APIs

Ingestion pipeline:

```text
source upload / crawl
  → text extraction
  → chunking
  → contextualization
  → embedding
  → store chunks + vectors + tsvector
```

Retrieval pipeline:

```text
query
  → vector search (pgvector)
  → keyword search (tsvector)
  → hybrid merge
  → rerank (RerankProvider)
  → top 3–6 chunks + citations
```

Embeddings/rerankers go through the configurable provider abstraction in `src/lib/ai/types.ts` (`EmbeddingProvider`, `RerankProvider`). Module code lives under `src/modules/knowledge/`.

## 📐 Rules & Constraints
- RAG is **ONLY** for documents / policies / FAQs. Products, orders, and stock are **structured tables** ([Module 15](module-15-structured-business-data.md)), not RAG.
- Ingestion runs as **background jobs on Trigger.dev** — never block the request path.
- Embeddings and rerankers are **multilingual and configurable** (Module 9) — must work for Arabic retrieval ([Module 21](module-21-arabic-english-rtl.md)).
- Retrieval returns **top 3–6 chunks** with **citations / source references**.
- When no relevant context is retrieved, the assistant must say **"I don't know"** (enforced by [Module 9](module-09-ai-assistant-engine.md)).
- All rows are tenant-scoped via `company_id`.

## ✅ Acceptance Criteria
- [ ] Company can upload docs
- [ ] Company can crawl its website
- [ ] Chunks are created
- [ ] Embeddings are stored
- [ ] Chatbot answers from retrieved context
- [ ] Chatbot says **"I don't know"** when context is missing

## 🔗 Related
- [Module 6 — Bot/Assistant Configuration](module-06-bot-assistant-configuration.md) — `bot_id` ownership
- [Module 9 — AI Assistant Engine](module-09-ai-assistant-engine.md) — consumes retrieval + enforces grounding / "I don't know"
- [Module 15 — Structured Business Data](module-15-structured-business-data.md) — products/orders/stock (NOT RAG)
- [Module 21 — Arabic / English / RTL](module-21-arabic-english-rtl.md) — Arabic retrieval
- Repo paths: `src/modules/knowledge/`, `src/lib/ai/types.ts`
