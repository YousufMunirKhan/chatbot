# Modules — Build Roadmap

The platform is built **module by module**. Each module has its own README with
a goal, build checklist, tables/tools, and acceptance criteria. Do **not** build
everything in one shot.

## The 25 modules

| # | Module | Milestone |
| --- | --- | --- |
| 1 | [Project Foundation](module-01-project-foundation.md) | M1 |
| 2 | [Database, Multi-Tenant Schema & Settings](module-02-database-multitenant-settings.md) | M1 |
| 3 | [Authentication & Role-Based Access](module-03-auth-rbac.md) | M1 |
| 4 | [Super Admin Dashboard](module-04-super-admin-dashboard.md) | M2 |
| 5 | [Company Admin Dashboard](module-05-company-admin-dashboard.md) | M2 |
| 6 | [Bot/Assistant Configuration](module-06-bot-assistant-configuration.md) | M2 |
| 7 | [Channel-Agnostic Conversation Engine](module-07-conversation-engine.md) | M3 |
| 8 | [Website Widget](module-08-website-widget.md) | M3 |
| 9 | [AI Assistant Engine](module-09-ai-assistant-engine.md) | M3 |
| 10 | [Knowledge Base Training / RAG](module-10-knowledge-base-rag.md) | M4 |
| 11 | [Business Inbox & Live Human Takeover](module-11-business-inbox-live-takeover.md) | M3 |
| 12 | [Leads Module](module-12-leads-module.md) | M5 |
| 13 | [Appointment Module](module-13-appointment-module.md) | M5 |
| 14 | [Integrations & Hourly Sync](module-14-integrations-hourly-sync.md) | M6 |
| 15 | [Structured Product/Stock/Menu/Order Data](module-15-structured-business-data.md) | M6 |
| 16 | [Product & Stock Assistant](module-16-product-stock-assistant.md) | M7 |
| 17 | [Order Details / Order Tracking](module-17-order-details-tracking.md) | M7 |
| 18 | [Conversational Order Placement](module-18-conversational-order-placement.md) | M7 |
| 19 | [Billing, Plans & Limits](module-19-billing-plans-limits.md) | M8 |
| 20 | [Usage, AI Cost, Revenue & Profit](module-20-usage-cost-revenue-profit.md) | M8 |
| 21 | [Arabic + English + RTL](module-21-arabic-english-rtl.md) | M4 |
| 22 | [Voice-Ready Design](module-22-voice-ready-design.md) | M9 |
| 23 | [Privacy, Security & Data Retention](module-23-privacy-security-retention.md) | M9 |
| 24 | [Notifications](module-24-notifications.md) | M5 |
| 25 | [Testing & Evaluation Harness](module-25-testing-evaluation-harness.md) | M9 |

## Milestones — ✅ all complete

| Milestone | Modules | Status |
| --- | --- | --- |
| **M1 — Foundation** | 1, 2, 3 | ✅ App runs, DB ready, login/roles |
| **M2 — Admin Panels** | 4, 5, 6 | ✅ Onboarding, company dashboard, assistant config |
| **M3 — Chat Core** | 7, 8, 9, 11 | ✅ Widget, AI replies, inbox, human takeover |
| **M4 — Knowledge Training** | 10, 21 | ✅ RAG (text), EN + AR + Arabizi handling |
| **M5 — Leads & Appointments** | 12, 13, 24 | ✅ Lead capture, appointments, notifications/email |
| **M6 — Integrations & Sync** | 14, 15 | ✅ CSV import + Woo/Shopify/Custom connectors + structured data |
| **M7 — Product, Stock, Orders** | 16, 17, 18 | ✅ Product Q&A, verified order tracking, cart/order placement, restaurant modifiers |
| **M8 — Billing & Analytics** | 19, 20 | ✅ Stripe checkout/webhook, message limits, real cost/revenue/profit |
| **M9 — Privacy, Voice-Ready, QA** | 22, 23, 25 | ✅ Voice-ready schema, privacy/retention, eval harness |

### Implementation notes (what's live vs. what needs keys/config)
- **Works with no external keys:** every module is functional in *mock mode*.
  RAG uses mock embeddings; the assistant replies via the mock provider.
- **Needs an AI key** (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`): real answers, and
  the OpenAI tool-calling loop that lets the AI invoke products/orders/leads/cart
  tools autonomously (the tools themselves are fully built + verified).
- **Needs provider credentials:** WooCommerce/Shopify/Custom-API live sync (CSV
  import works with no setup). Stripe checkout needs price IDs. Email needs Resend.
- **Scheduling:** hourly sync + 30-day retention run via `POST /api/cron`
  (wire to Trigger.dev/Vercel Cron with the service-role bearer).
- **Voice (Module 22)** is architecture-only by design — the schema + channel
  abstraction are ready; STT/TTS/telephony are out of scope for this phase.

## Dependency graph (high level)

```
M1 (1,2,3)
   └── M2 (4,5,6)
         └── M3 (7,8,9,11)
               ├── M4 (10, 21)
               ├── M5 (12,13,24)
               └── M6 (14,15)
                     └── M7 (16,17,18)
                           └── M8 (19,20)
                                 └── M9 (22,23,25)
```

## User roles

| Role | Can |
| --- | --- |
| **Platform Super Admin** | Onboard companies, create company admins, set trial/free-until, assign subscriptions & limits, view all companies/bots/usage/revenue/AI cost/profit/sync status, disable companies, impersonate company admin (audited) |
| **Company Admin** | Manage business profile, create/manage assistants, upload/train data, connect integrations, manage inbox/leads/appointments/orders/agents, configure widget, view usage & billing, export own data |
| **Agent** | View assigned chats, reply manually, pause/resume AI, close chat, mark lead, see customer/order/cart context, handle appointment/order enquiries |
| **Visitor** | Chat with AI, ask support/sales/product/stock questions, request appointments, provide lead details, check order details after verification, place orders, chat with a human agent on takeover |

## Developer Rules

These are enforced across every module:

1. Do not build everything in one shot.
2. Every module ships clear database migrations.
3. Every setting comes from platform/company/bot settings where possible.
4. The AI provider must be switchable.
5. The widget must not contain business logic.
6. All sensitive API keys stay backend-only.
7. Integration tokens must be encrypted.
8. Order placement must require backend validation.
9. Order details must require customer verification.
10. A human agent reply must pause AI for that conversation.
11. All data must be company-isolated.
12. Website chat must be channel-based so future voice reuses the engine.
13. Structured data must not be stored only as vector chunks.
14. RAG is for documents/policies/FAQs; products/orders/customers/stock are
    structured tables.
15. Restaurant products must support variants, modifiers, combos, add-ons,
    availability, and required choices.
16. Arabic/English support must be **tested**, not just translated.
17. Super admin must see AI cost, revenue, and profit/loss per company.
18. Use background jobs for sync, ingestion, cleanup, and retries.

## First build prompt

The canonical prompt to start Module 1 is preserved in
[module-01-project-foundation.md](module-01-project-foundation.md#first-build-prompt).
