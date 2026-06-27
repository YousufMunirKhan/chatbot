# Module 6 — Bot/Assistant Configuration

> **Milestone:** M2 · **Depends on:** [Module 2](module-02-database-multitenant-settings.md), [Module 5](module-05-company-admin-dashboard.md) · **Status:** ✅ Implemented

## 🧩 Implementation in this repo
- Bilingual prompt template library (EN + AR): `src/lib/ai/prompts/templates.ts` — base personas per bot type, capability snippets, grounding rules, language directives
- Prompt assembler (pure): `src/lib/ai/prompts/assemble.ts` — `assembleSystemPrompt()` builds the system prompt from role + industry + capabilities + business context + grounding + language
- Persistence + sync: `src/modules/company/prompt.ts` (`recomputeBotPrompt`, `loadPromptConfig`) — config stored in `bot_settings` (`prompt_config`), assembled prompt stored on `bots.system_prompt`; resynced on every bot create/update and prompt save
- Action: `updatePromptConfigAction` (`src/modules/company/actions.ts`)
- UI: `PromptConfigForm` + a live **assembled system prompt** preview on `/company/bots/[id]/settings`
- Verify: `npm run test:prompt` (persistence). Assembly output verified for EN/AR/custom.
- Note: bot types & capabilities live on the `bots` row (created in Module 5); this module adds the prompt-template assembly and saves config in settings.

## 🎯 Goal
Let a company admin create and configure a single, reusable AI assistant: choose its **bot type**, toggle the **capabilities** it should have, and have the system assemble a final prompt from role + industry + enabled capabilities. The whole config persists through the settings system so the rest of the platform can read it.

## 📦 What to build
- [ ] Bot-type selection (`help_desk`, `sales_agent`, `hybrid_business_assistant`, `informational`, `custom`) with **`hybrid_business_assistant`** as the recommended default
- [ ] Capability toggles — each bot can independently enable/disable: `help_desk`, `sales_agent`, `lead_capture`, `appointment_booking`, `product_stock_assistant`, `order_tracking`, `order_placement`, `human_agent_takeover`, `live_chat`
- [ ] Prompt template library (EN + AR per role):
  - support prompt EN / support prompt AR
  - sales prompt EN / sales prompt AR
  - hybrid prompt EN / hybrid prompt AR
  - informational prompt EN / informational prompt AR
  - custom prompt
- [ ] Prompt assembler that combines **role + industry + enabled capabilities** into the final system prompt
- [ ] Persistence of the full assistant config via the Module 2 settings system
- [ ] Company-admin configuration UI surfaced from the dashboard ([Module 5](module-05-company-admin-dashboard.md))

## 🗄️ Database / Tables
None — assistant configuration persists through the **settings system** from [Module 2](module-02-database-multitenant-settings.md) (no new tables introduced by this module). A bot is identified by `bot_id`, which downstream modules (7, 8, 9, 10) reference.

## 🔧 Tools / Interfaces / APIs
Enums are defined in `src/lib/constants.ts`:

| Constant | Values |
| --- | --- |
| `BOT_TYPES` | `help_desk`, `sales_agent`, `hybrid_business_assistant`, `informational`, `custom` |
| `BOT_CAPABILITIES` | `help_desk`, `sales_agent`, `lead_capture`, `appointment_booking`, `product_stock_assistant`, `order_tracking`, `order_placement`, `human_agent_takeover`, `live_chat` |

Prompt assembly pipeline:

```text
role template (by bot type, EN/AR)
  + industry context
  + enabled capability instructions
  → final system prompt (consumed by Module 9 AI Assistant Engine)
```

Module code lives under `src/modules/bots/`.

## 📐 Rules & Constraints
- Bot types and capabilities **must** come from the `BOT_TYPES` / `BOT_CAPABILITIES` enums in `src/lib/constants.ts` — never hardcode ad-hoc strings.
- Config is **saved in settings** (Module 2), not in bespoke per-feature storage.
- The final prompt is **assembled**, not authored by hand per company: `role + industry + capabilities`.
- Capabilities are independent toggles — a single assistant can combine many (e.g. a hybrid bot with lead capture + appointment booking + order tracking).
- Prompt templates must exist in both **English and Arabic** for every role (see [Module 21](module-21-arabic-english-rtl.md)).

## ✅ Acceptance Criteria
- [ ] A company admin can create **one** assistant with multiple capabilities
- [ ] The assistant config is saved in settings
- [ ] The final prompt is assembled from **role + industry + capabilities**
- [ ] Bot type defaults to `hybrid_business_assistant`
- [ ] EN and AR prompt templates exist for support, sales, hybrid, and informational roles, plus a custom prompt

## 🔗 Related
- [Module 2 — Database, Multi-Tenant Schema & Settings](module-02-database-multitenant-settings.md) — settings persistence
- [Module 5 — Company Admin Dashboard](module-05-company-admin-dashboard.md) — where admins configure the bot
- [Module 7 — Conversation Engine](module-07-conversation-engine.md) — conversations reference `bot_id`
- [Module 9 — AI Assistant Engine](module-09-ai-assistant-engine.md) — consumes the assembled prompt + capabilities
- [Module 10 — Knowledge Base / RAG](module-10-knowledge-base-rag.md) — grounding source for the assistant
- [Module 21 — Arabic / English / RTL](module-21-arabic-english-rtl.md) — bilingual prompt templates
- Repo paths: `src/modules/bots/`, `src/lib/constants.ts`, `src/lib/settings/index.ts`
