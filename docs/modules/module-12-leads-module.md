# Module 12 — Leads Module

> **Milestone:** M5 · **Depends on:** [Module 7](./module-07-conversation-engine.md), [Module 9](./module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented

## 🎯 Goal
Capture and manage leads generated through conversations, escalations, appointment requests, order enquiries, missed chats, and manual agent action.

## 📦 What to build
- [ ] Lead capture path: AI collects lead details via a tool (see [Module 9](./module-09-ai-assistant-engine.md) tool layer)
- [ ] Lead persistence using the defined lead fields
- [ ] Leads dashboard page (the leads page from [Module 5](./module-05-company-admin-dashboard.md))
- [ ] CSV export of leads
- [ ] Email notification to the business on new lead (handled by [Module 24](./module-24-notifications.md))
- [ ] Manual "mark as lead" action for agents
- [ ] Code under the leads area of `src/modules/company/`

## 🗄️ Database / Tables
**Lead fields:**

| Field | Notes |
|---|---|
| `name` | Lead name |
| `email` | Contact email |
| `phone` | Contact phone |
| `enquiry_type` | Type of enquiry |
| `message` | Lead message / context |
| `source_page` | Page the lead originated from |
| `conversation_id` | Originating conversation ([Module 7](./module-07-conversation-engine.md)) |
| `bot_id` | Bot that captured the lead |
| `company_id` | Tenant owner |
| `status` | Lead status |
| `created_at` | Creation timestamp |

> A `leadSchema` Zod schema already exists in `src/schemas/index.ts`.

## 🔧 Tools / Interfaces / Flow
**Lead sources:**
- Sales conversation
- Support escalation
- Appointment request ([Module 13](./module-13-appointment-module.md))
- Order enquiry
- Missed chat
- Manual agent "mark as lead"

**Flow:**
```
Visitor in chat
  → AI collects lead details via lead tool (Module 9)
  → validate against leadSchema (src/schemas/index.ts)
  → insert lead row (company_id, bot_id, conversation_id, ...)
  → lead appears in dashboard (Module 5 leads page)
  → email notification sent to business (Module 24)
```

## 📐 Rules & Constraints
- Leads are scoped per tenant via `company_id`.
- Lead data validated against `leadSchema` before persistence.
- AI collects leads through the Module 9 tool layer — not by ad-hoc parsing.
- Email notifications are delegated to [Module 24](./module-24-notifications.md).

## ✅ Acceptance Criteria
- [ ] AI can collect lead details
- [ ] Lead appears in the dashboard
- [ ] Lead can be exported as CSV
- [ ] Business receives an email notification

## 🔗 Related
- [Module 5 — Company Admin Dashboard](./module-05-company-admin-dashboard.md) — leads page
- [Module 7 — Conversation Engine](./module-07-conversation-engine.md) — `conversation_id` source
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) — lead-collection tool
- [Module 11 — Business Inbox and Live Takeover](./module-11-business-inbox-live-takeover.md) — leads in the inbox
- [Module 13 — Appointment Module](./module-13-appointment-module.md) — appointment requests as a lead source
- [Module 24 — Notifications](./module-24-notifications.md) — lead email notifications
- Code: leads area of `src/modules/company/`, `src/schemas/index.ts` (`leadSchema`)
