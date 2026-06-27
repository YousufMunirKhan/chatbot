# Module 24 — Notifications

> **Milestone:** M5 · **Depends on:** [Module 12](./module-12-leads-module.md), [Module 13](./module-13-appointment-module.md) · **Status:** ✅ Implemented

## 🎯 Goal
Notify businesses about important events via email and an in-app dashboard surface.

## 📦 What to build
- [ ] Send notifications for **new lead**
- [ ] Send notifications for **human takeover required**
- [ ] Send notifications for **missed conversation**
- [ ] Send notifications for **new appointment request**
- [ ] Send notifications for **new order**
- [ ] Send notifications for **failed payment**
- [ ] Send notifications for **failed sync**
- [ ] Send notifications for **over usage limit**
- [ ] Send notifications for **integration disconnected**
- [ ] Email channel (Phase 1)
- [ ] Dashboard notification surface (Phase 1)

## 🗄️ Database / Tables
None specified — cross-cutting. Events originate from other modules (see below); keep an in-app dashboard notifications surface.

## 🔧 Functions / Interfaces / Events
**Channels — Phase 1:**
- Email
- Dashboard notification

**Channels — Future:**
- WhatsApp
- Slack
- SMS
- Push notification

**Events** (originate from Modules 11/12/13/14/18/19):
- new lead · human takeover required · missed conversation · new appointment request · new order · failed payment · failed sync · over usage limit · integration disconnected

**Email provider** is configurable (Resend / SendGrid / SES) via `RESEND_API_KEY` + `EMAIL_FROM`.

## 📐 Rules & Constraints
- Phase 1 delivers **email** and **dashboard** notifications only; WhatsApp/Slack/SMS/push are future.
- Email provider must be **configurable** (Resend/SendGrid/SES) via `RESEND_API_KEY` + `EMAIL_FROM`.
- Keep an **in-app dashboard notifications surface** in addition to email.
- Events are emitted by source modules ([11](./module-11-business-inbox-live-takeover.md), [12](./module-12-leads-module.md), [13](./module-13-appointment-module.md), [14](./module-14-integrations-hourly-sync.md), [18](./module-18-conversational-order-placement.md), [19](./module-19-billing-plans-limits.md)).

## ✅ Acceptance Criteria
- [ ] Lead email sends
- [ ] Order email sends
- [ ] Appointment email sends
- [ ] Dashboard notifications show

## 🔗 Related
- [Module 11 — Business Inbox & Live Takeover](./module-11-business-inbox-live-takeover.md) (human takeover, missed conversation)
- [Module 12 — Leads Module](./module-12-leads-module.md) (new lead)
- [Module 13 — Appointment Module](./module-13-appointment-module.md) (new appointment request)
- [Module 14 — Integrations & Hourly Sync](./module-14-integrations-hourly-sync.md) (failed sync, integration disconnected)
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md) (new order)
- [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) (failed payment, over usage limit)
- Config: `RESEND_API_KEY`, `EMAIL_FROM`
