# Module 17 — Order Details / Order Tracking

> **Milestone:** M7 · **Depends on:** [Module 15 — Structured Business Data](./module-15-structured-business-data.md) · **Status:** ✅ Implemented

## 🎯 Goal
Let visitors check their order status safely. Order details are only revealed after the customer is verified — never from an order number alone.

## 📦 What to build
- [ ] Customer verification step before any order detail is returned
- [ ] AI tool functions for order status, items, and tracking
- [ ] Block results when the supplied phone/email does not match the order
- [ ] Bilingual (Arabic + English) order tracking

## 🗄️ Database / Tables
None — uses the order tables from [Module 15 — Structured Business Data](./module-15-structured-business-data.md).

## 🔧 Tools / Functions / Flow
AI tool functions:

- `verify_customer_for_order`
- `get_order_status`
- `get_order_items`
- `get_tracking_info`

Verification rule: never reveal order details from the order number alone. Require **order number + phone**, OR **order number + email**. `verify_customer_for_order` must pass before any of the other tools return data.

## 📐 Rules & Constraints
- This is a security-sensitive flow: order details require customer verification (developer rule).
- Never reveal order details from an order number alone.
- Verification requires order number + phone, OR order number + email.
- A wrong phone/email must block the result.
- No card details in chat (see [Module 23 — Privacy, Security & Retention](./module-23-privacy-security-retention.md)).

## ✅ Acceptance Criteria
- [ ] Order lookup works after verification.
- [ ] A wrong phone/email blocks the result.
- [ ] Arabic and English order tracking works.

## 🔗 Related
- [Module 15 — Structured Business Data](./module-15-structured-business-data.md)
- [Module 16 — Product & Stock Assistant](./module-16-product-stock-assistant.md)
- [Module 18 — Conversational Order Placement](./module-18-conversational-order-placement.md)
- [Module 21 — Arabic / English & RTL](./module-21-arabic-english-rtl.md) (bilingual tracking)
- [Module 23 — Privacy, Security & Retention](./module-23-privacy-security-retention.md) (no card details in chat)
- Repo code paths: `src/lib/tools/index.ts`
