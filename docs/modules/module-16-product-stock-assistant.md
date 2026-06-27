# Module 16 — Product & Stock Assistant

> **Milestone:** M7 · **Depends on:** [Module 15 — Structured Business Data](./module-15-structured-business-data.md), [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md) (tool layer) · **Status:** ✅ Implemented

## 🎯 Goal
Answer product, menu, price, stock, and availability questions for visitors. All product, price, and stock facts come from synced structured tables — the AI never invents them.

## 📦 What to build
- [ ] AI tool functions for product search and details
- [ ] AI tool functions for stock and availability checks
- [ ] AI tool functions for restaurant menu lookups and item options
- [ ] Wire all tools into the tool layer so they read from Module 15 structured tables
- [ ] Out-of-stock handling that suggests alternatives
- [ ] Bilingual (Arabic + English) product question support

## 🗄️ Database / Tables
None — uses the structured tables from [Module 15 — Structured Business Data](./module-15-structured-business-data.md) (products, menu items, stock, price, options).

## 🔧 Tools / Functions / Flow
AI tool functions (created as tools in the tool layer):

- `search_products`
- `get_product_details`
- `check_stock`
- `search_restaurant_menu`
- `get_menu_item_options`
- `check_item_availability`

These tools live in the tool layer (`src/lib/tools/index.ts`) and read from the Module 15 structured tables.

## 📐 Rules & Constraints
- Product stock must come from structured tables.
- Price must come from structured tables.
- AI must not invent price.
- AI must not invent stock.
- If a product is unavailable, say it is unavailable and suggest alternatives.

## ✅ Acceptance Criteria
- [ ] A visitor can ask "do you have this?" and get a correct answer.
- [ ] A visitor can ask Arabic product questions.
- [ ] The bot answers from synced data.
- [ ] The bot suggests alternatives if an item is out of stock.

## 🔗 Related
- [Module 15 — Structured Business Data](./module-15-structured-business-data.md)
- [Module 9 — AI Assistant Engine](./module-09-ai-assistant-engine.md)
- [Module 17 — Order Details / Order Tracking](./module-17-order-details-tracking.md)
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md)
- [Module 21 — Arabic / English & RTL](./module-21-arabic-english-rtl.md) (Arabic product questions)
- Repo code paths: `src/lib/tools/index.ts`
