# Module 8 — Website Widget

> **Milestone:** M3 · **Depends on:** [Module 7](module-07-conversation-engine.md), [Module 9](module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- `public/widget/widget.js` — self-contained vanilla-JS widget (no framework): bubble, window, SSE streaming, lead/agent messages, RTL (Arabic), `data-*` config, localStorage visitor/conversation ids, agent-reply polling
- `public/widget/demo.html` — local test page
- Talks only to `POST /api/chat` (SSE) and `GET /api/chat/messages`; **no business logic in the widget**. Domain allow-list enforced server-side (`isOriginAllowed` in `src/lib/ai/engine.ts`)
- Embed snippet shown per assistant on `/company/bots/[id]/settings` and `/company/widget`.

## 🎯 Goal
Build the embeddable website chat widget — a tiny, framework-free script a customer drops onto their site with a single `<script>` tag. It renders the chat UI and relays messages to the backend; it contains **no business logic**.

## 📦 What to build
- [ ] Vanilla JS + TypeScript widget, bundled into **one small file**, loaded by a script tag, with **no React dependency** inside the customer's website
- [ ] Chat bubble + chat window
- [ ] Streaming AI replies (via SSE)
- [ ] Lead capture form
- [ ] Appointment request flow
- [ ] Product / order flow
- [ ] Human agent messages (delivered via Supabase Realtime)
- [ ] RTL support + Arabic/English UI strings
- [ ] Customization: custom colours, logo, welcome message, position (left/right)
- [ ] Mobile responsive layout
- [ ] Domain allowlist enforcement

## 🗄️ Database / Tables
None — uses tables from [Module 7](module-07-conversation-engine.md) (`conversations`, `messages`). The widget only sends/receives messages.

## 🔧 Tools / Interfaces / APIs

Embed snippet (drop into the customer's site):

```html
<script src="https://cdn.yourdomain.com/widget.js" data-bot-id="PUBLIC_BOT_ID"></script>
```

Runtime wiring:

```text
widget.js (browser)
  ── send message ──▶  AI Assistant Engine (Module 9)
  ◀── SSE stream ────  streaming AI reply tokens
  ◀── Realtime ──────  human agent messages (Supabase Realtime, Module 11)
```

- **Streaming** of AI replies is over **SSE**.
- **Human messages** arrive via **Supabase Realtime** ([Module 11](module-11-business-inbox-live-takeover.md)).
- Built bundle is served from `public/widget/widget.js`; CORS + cache headers are configured in `next.config.mjs`.
- Widget source lives under `src/modules/widget/`.

## 📐 Rules & Constraints
- **CRITICAL:** the widget contains **NO business logic** — it only sends/receives messages. All decisions (language detection, intent, tools, grounding, "I don't know") live in the backend AI Assistant Engine ([Module 9](module-09-ai-assistant-engine.md)).
- Domain **allow-listing is enforced server-side** ([Module 23](module-23-privacy-security-retention.md)) — never trusted to the client.
- No React (or other heavy framework) inside the customer page; keep the bundle small.
- Arabic mode must render **RTL** ([Module 21](module-21-arabic-english-rtl.md)).
- The bot is referenced by a **public** `data-bot-id`; no secrets ship in the embed.

## ✅ Acceptance Criteria
- [ ] Widget works on a test HTML site
- [ ] Widget streams AI replies
- [ ] Arabic mode is RTL
- [ ] Domain allowlist blocks unauthorized domains

## 🔗 Related
- [Module 7 — Conversation Engine](module-07-conversation-engine.md) — message/conversation storage
- [Module 9 — AI Assistant Engine](module-09-ai-assistant-engine.md) — all logic lives here
- [Module 11 — Business Inbox & Live Takeover](module-11-business-inbox-live-takeover.md) — human messages via Realtime
- [Module 21 — Arabic / English / RTL](module-21-arabic-english-rtl.md) — RTL + bilingual UI strings
- [Module 23 — Privacy, Security & Retention](module-23-privacy-security-retention.md) — server-side domain allowlist
- Repo paths: `src/modules/widget/`, `public/widget/widget.js`, `next.config.mjs`
