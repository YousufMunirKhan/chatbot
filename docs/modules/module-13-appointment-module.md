# Module 13 — Appointment Module

> **Milestone:** M5 · **Depends on:** [Module 7](./module-07-conversation-engine.md), [Module 9](./module-09-ai-assistant-engine.md) · **Status:** ✅ Implemented

## 🎯 Goal
Allow visitors to request and book appointments through chat. The AI collects the details, an appointment request is created, and a company admin or agent confirms it manually.

## 📦 What to build
- [ ] AI appointment-collection tool (via [Module 9](./module-09-ai-assistant-engine.md))
- [ ] `appointments` table and persistence
- [ ] Appointments dashboard view with confirm / cancel actions
- [ ] Status lifecycle handling
- [ ] Email notification on appointment request/confirmation (via [Module 24](./module-24-notifications.md))
- [ ] Code under `src/modules/appointments/`

## 🗄️ Database / Tables
**`appointments`:**

| Field | Notes |
|---|---|
| `id` | Primary key |
| `company_id` | Tenant owner |
| `bot_id` | Bot that captured the request |
| `conversation_id` | Originating conversation ([Module 7](./module-07-conversation-engine.md)) |
| `customer_name` | Customer name |
| `customer_phone` | Customer phone |
| `customer_email` | Customer email |
| `service_type` | Type of service / appointment |
| `preferred_date` | Requested date |
| `preferred_time` | Requested time |
| `notes` | Free-text notes |
| `status` | See statuses below |
| `assigned_agent_id` | Agent handling the appointment |
| `created_at` | Creation timestamp |

**Statuses:** `requested`, `confirmed`, `cancelled`, `completed`, `no_show`

## 🔧 Tools / Interfaces / Flow
**Appointment use cases:** clinic appointment, salon appointment, real estate viewing, demo booking, restaurant table request, service visit, consultation.

**Phase 1 flow:**
```
Visitor requests appointment in chat
  → AI collects details via appointment tool (Module 9)
  → appointment request created (status = requested)
  → company admin/agent confirms manually (status = confirmed)
  → email notification sent (Module 24)
```

**Future ready (later integrations):** Google Calendar, Calendly, clinic system, restaurant reservation system, salon booking system.

## 📐 Rules & Constraints
- Phase 1 is request-and-manual-confirm — no automatic calendar booking yet.
- AI collects appointment data through the Module 9 tool layer.
- Appointments are scoped per tenant via `company_id`.
- Status must move only through the defined lifecycle (`requested` → `confirmed`/`cancelled` → `completed`/`no_show`).
- Notifications are delegated to [Module 24](./module-24-notifications.md).

## ✅ Acceptance Criteria
- [ ] Visitor can request an appointment in chat
- [ ] Appointment appears in the dashboard
- [ ] Admin can confirm or cancel an appointment

## 🔗 Related
- [Module 7 — Conversation Engine](./module-07-conversation-engine.md) — `conversation_id` source
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) — appointment-collection tool
- [Module 11 — Business Inbox and Live Takeover](./module-11-business-inbox-live-takeover.md) — appointment requests in the inbox
- [Module 12 — Leads Module](./module-12-leads-module.md) — appointment requests as a lead source
- [Module 24 — Notifications](./module-24-notifications.md) — appointment email notifications
- Code: `src/modules/appointments/`
