# Module 11 — Business Inbox and Live Human Takeover

> **Milestone:** M3 · **Depends on:** [Module 7](./module-07-conversation-engine.md), [Module 8](./module-08-website-widget.md), [Module 9](./module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Data + actions: `src/modules/company/inbox-data.ts`, `inbox-actions.ts` — `sendAgentReplyAction` (takeover: `ai_enabled=false`, `status=human_active`, assigns agent, resets unread), `pauseAi`/`resumeAi`/`closeChat`
- UI: `/company/inbox` (list) + `/company/inbox/[id]` (thread, controls, reply)
- Realtime: `inbox-realtime.tsx` subscribes to Supabase Realtime `messages` inserts; the public chat API pauses the model when `ai_enabled=false` and the widget polls for agent replies
- Verified by `npm run test:inbox` — ✅ AI pauses on agent reply, visitor messages don't trigger AI during takeover, agent reply reaches the widget, AI resumes.

## 🎯 Goal
Create a single unified inbox for chats, leads, order enquiries, appointment requests, missed conversations, and human takeover. Agents can step into any AI conversation, take over from the bot, reply manually, and hand control back to the AI.

## 📦 What to build
- [ ] Unified inbox UI listing all conversation types (chats, leads, appointment requests, order enquiries, missed conversations)
- [ ] Inbox row/detail showing: customer name, phone/email, agent replies, AI/human status, assigned agent, unread count, language, channel, and current cart/order (if any)
- [ ] Human takeover logic: when an agent sends a manual reply, set `conversation.ai_enabled = false` and `conversation.status = human_active`
- [ ] Visitor-reply handling during takeover: save the visitor message, notify the agent, and do **not** call the AI
- [ ] Agent actions: **Resume AI**, **Pause AI**, **Close Chat**
- [ ] Realtime wiring for instant message delivery, typing indicators, unread counts, and status updates
- [ ] Code under `src/modules/inbox/`

## 🗄️ Database / Tables
Reuses the `conversations` and `messages` tables from [Module 7](./module-07-conversation-engine.md). Key fields used by the inbox:

| Table | Field | Purpose |
|---|---|---|
| conversations | `ai_enabled` | `false` while a human agent has taken over |
| conversations | `status` | e.g. `human_active`; drives AI/human badge and routing |
| conversations | `assigned_agent_id` | Agent currently handling the conversation |
| conversations | `unread_count` | Unread messages for the inbox badge |
| conversations | `language` | Conversation language (Arabic / English) |
| conversations | `channel` | Source channel of the conversation |
| messages | sender / role | Distinguishes AI, agent, and visitor messages |

> Exact column definitions live in [Module 7](./module-07-conversation-engine.md) and [Module 2](./module-02-database-multitenant-settings.md).

## 🔧 Tools / Interfaces / Flow
Realtime channel helpers live in `src/lib/realtime/index.ts` (`conversationChannel`, `inboxChannel`).

**Supabase Realtime is used for:**
- Visitor message notification
- Agent reply delivery (to the widget)
- Typing indicator
- Unread count update
- AI/human status update

**Human takeover flow:**
```
Default: AI answers (conversation.ai_enabled = true)

Agent sends manual reply
  → conversation.ai_enabled = false
  → conversation.status = human_active
  → reply delivered to widget via conversationChannel (realtime)

Visitor replies after takeover
  → save visitor message
  → notify agent (inboxChannel / conversationChannel)
  → DO NOT call AI

Agent clicks "Resume AI"
  → conversation.ai_enabled = true
  → AI resumes answering
```

## 📐 Rules & Constraints
- AI answers by default; a manual agent reply is what triggers takeover.
- While `ai_enabled = false`, visitor replies must **never** trigger the AI.
- Agent reply must appear instantly in the widget (realtime delivery).
- Agents can always **Resume AI**, **Pause AI**, or **Close Chat**.
- The inbox spans all conversation types — it is the single operational surface for live human work.

## ✅ Acceptance Criteria
- [ ] Agent reply appears instantly in the widget
- [ ] AI stops answering as soon as an agent replies
- [ ] Visitor replies do **not** trigger the AI during human takeover
- [ ] Agent can resume AI and the bot takes over again

## 🔗 Related
- [Module 7 — Conversation Engine](./module-07-conversation-engine.md) — `conversations` / `messages` tables
- [Module 8 — Website Widget](./module-08-website-widget.md) — widget receives agent messages
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) — AI answering that takeover suspends
- [Module 12 — Leads Module](./module-12-leads-module.md) — leads surfaced in the inbox
- [Module 13 — Appointment Module](./module-13-appointment-module.md) — appointment requests in the inbox
- [Module 24 — Notifications](./module-24-notifications.md) — agent notifications
- Code: `src/modules/inbox/`, `src/lib/realtime/index.ts` (`conversationChannel`, `inboxChannel`)
