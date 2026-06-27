# Module 15 — Structured Product, Stock, Restaurant Menu, and Order Data

> **Milestone:** M6 · **Depends on:** [Module 14](./module-14-integrations-hourly-sync.md) · **Status:** ✅ Implemented

## 🎯 Goal
Store business product, stock, restaurant menu, and order data in structured relational tables — not only as vector chunks — so the AI tools have a reliable source of truth for price and stock.

## 📦 What to build
- [ ] Core synced tables (products, variants, inventory, orders, order items, customers)
- [ ] Restaurant-specific tables (menu items, variants, modifiers, combos, availability, kitchen routing)
- [ ] Full restaurant modeling: variants, sizes, modifiers, required choices, optional add-ons, meal deals, combos, half-and-half items (where possible), special instructions, availability by day/time, out-of-stock items, kitchen routing, allergy notes, delivery/pickup rules
- [ ] Backend final-price calculation
- [ ] Enforcement that required options are collected before a restaurant order item can be added to the cart

## 🗄️ Database / Tables
**Core tables:**

| Table | Purpose |
|---|---|
| `synced_products` | Products |
| `synced_product_variants` | Product variants |
| `synced_inventory` | Stock levels |
| `synced_orders` | Orders |
| `synced_order_items` | Order line items |
| `synced_customers` | Customers |

**Restaurant-specific tables:**

| Table | Purpose |
|---|---|
| `restaurant_menu_items` | Menu items |
| `restaurant_menu_variants` | Menu item variants (e.g. sizes) |
| `modifier_groups` | Groups of modifiers |
| `modifiers` | Individual modifiers / add-ons |
| `menu_item_modifier_groups` | Links menu items to modifier groups |
| `combo_groups` | Meal-deal / combo groupings |
| `combo_options` | Options within a combo |
| `availability_rules` | Availability by day/time |
| `kitchen_routing_rules` | Kitchen routing |

## 🔧 Tools / Interfaces / Flow
This is the structured source of truth consumed by the AI tools in [Module 16](./module-16-product-stock-assistant.md), [Module 17](./module-17-order-details-tracking.md), and [Module 18](./module-18-conversational-order-placement.md). Data is populated by the connectors in [Module 14](./module-14-integrations-hourly-sync.md).

**Required-options enforcement (restaurant) example:**
```
Item requires: size, crust

Visitor: "I'll have a pizza"
  AI → ask for size
  AI → ask for crust
  → only after size AND crust collected → item may be added to cart

AI must NOT place a restaurant order until all required options are collected.
```

## 📐 Rules & Constraints
- **Structured data must NOT be stored only as vector chunks.**
- **Price and stock always come from these tables — never invented by the model.**
- The backend computes the final price (see [Module 18](./module-18-conversational-order-placement.md)).
- AI must not place a restaurant order until all required options are collected (ask each required choice in turn, e.g. size then crust).
- Restaurant modeling must support required choices, optional add-ons, combos, availability, out-of-stock, kitchen routing, allergy notes, and delivery/pickup rules.

## ✅ Acceptance Criteria
- [ ] Simple products work
- [ ] Variable products work
- [ ] Restaurant menu modifiers work
- [ ] Required choices are enforced
- [ ] Backend calculates the final price

## 🔗 Related
- [Module 14 — Integrations and Hourly Sync](./module-14-integrations-hourly-sync.md) — populates these tables
- [Module 16 — Product & Stock Assistant](./module-16-product-stock-assistant.md) — reads price/stock
- [Module 17 — Order Details & Tracking](./module-17-order-details-tracking.md) — reads order data
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md) — backend final-price calculation
- [Module 10 — Knowledge Base & RAG](./module-10-knowledge-base-rag.md) — vector chunks (contrast: structured data is not stored only as chunks)
