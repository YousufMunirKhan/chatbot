# Module 20 — Usage, AI Cost, Revenue & Profit Dashboard

> **Milestone:** M8 · **Depends on:** [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md), [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) · **Status:** ✅ Implemented

## 🎯 Goal
Track AI cost and profitability. Every AI call logs its cost, the company admin sees a value dashboard, and the super admin sees profit/loss per company.

## 📦 What to build
- [ ] `ai_usage_logs` table
- [ ] Cost logging on every AI call from the engine (Module 9)
- [ ] Company admin analytics (value dashboard)
- [ ] Super admin analytics (cost, revenue, profit/loss)

## 🗄️ Database / Tables
**`ai_usage_logs`**

| Field | Notes |
| --- | --- |
| `id` | Primary key |
| `company_id` | Tenant |
| `bot_id` | Bot the call belongs to |
| `conversation_id` | Conversation the call belongs to |
| `provider` | AI provider used |
| `model` | Model used |
| `operation_type` | chat / embedding / rerank / contextualize / tool_call |
| `input_tokens` | Input token count |
| `output_tokens` | Output token count |
| `estimated_cost` | Estimated cost of the call |
| `created_at` | Timestamp |

Operation types: `chat`, `embedding`, `rerank`, `contextualize`, `tool_call`.

## 🔧 Tools / Functions / Flow
- Every AI call from the engine ([Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md)) must write an `ai_usage_logs` row.
- Revenue comes from [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) subscriptions.
- Profit = revenue − AI cost.

**Company admin analytics (show):**
- messages used
- leads captured
- top questions
- orders created
- appointments created
- missed chats
- conversion rate
- AI handled vs human handled
- usage vs plan limit

**Super admin analytics (show):**
- company usage
- AI cost per company
- total AI cost
- revenue
- profit / loss
- subscription status
- free trial expiry
- free-until date
- heavy usage alerts

## 📐 Rules & Constraints
- Every AI call from the engine must write an `ai_usage_logs` row.
- Profit = revenue − AI cost.
- Developer rule: the super admin must see AI cost, revenue, and profit/loss per company.

## ✅ Acceptance Criteria
- [ ] Every AI call logs cost.
- [ ] The super admin sees profit/loss by company.
- [ ] The company admin sees a value dashboard.

## 🔗 Related
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) (logs every AI call)
- [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) (revenue source)
- [Module 4 — Super Admin Dashboard](./module-04-super-admin-dashboard.md) (super-admin views)
- Repo code paths: `src/modules/analytics/`
