# Module 18 — Conversational Order Placement

> **Milestone:** M7 · **Depends on:** [Module 15 — Structured Business Data](./module-15-structured-business-data.md), [Module 16 — Product & Stock Assistant](./module-16-product-stock-assistant.md), [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) (Stripe/billing) · **Status:** ✅ Implemented

## 🎯 Goal
Allow a visitor to place an order through chat. The backend always validates, computes totals, and creates the order — the model never does.

## 📦 What to build
- [ ] Cart management (create, add, remove, update items)
- [ ] Backend total calculation and cart validation
- [ ] Order creation across supported order types
- [ ] Stripe payment link generation
- [ ] Shopify draft order creation
- [ ] WooCommerce order creation
- [ ] Restaurant menu orders with modifiers / required choices
- [ ] Customer-detail collection, order summary, and explicit confirmation step
- [ ] Business notification on order creation

### Supported order types
- Internal order
- Shopify draft order
- WooCommerce order
- Payment link order
- Cash on delivery order
- Manual order request

## 🗄️ Database / Tables
Cart and order tables:

| Table | Purpose |
| --- | --- |
| `chat_carts` | Active chat carts |
| `chat_cart_items` | Line items in a chat cart |
| `chat_orders` | Orders created from chat |
| `chat_order_items` | Line items of a chat order |
| `payments` | Payment records (e.g. Stripe payment links) |

## 🔧 Tools / Functions / Flow
Required backend tools:

- `create_cart`
- `add_to_cart`
- `remove_from_cart`
- `update_cart_item`
- `calculate_total`
- `validate_cart`
- `create_order`
- `create_payment_link`
- `create_shopify_draft_order`
- `create_woocommerce_order`

Order flow:

```
customer asks for product/menu item
  → AI searches product/menu
  → backend checks options/stock/price
  → AI asks required choices
  → item added to cart
  → AI collects customer details
  → AI shows summary
  → customer confirms
  → backend creates order/payment/checkout
  → business notified
```

## 📐 Rules & Constraints
- The AI must NOT directly create a final order without: backend validation; customer details; order summary; explicit customer confirmation.
- The backend computes totals and validates — never the model.
- Restaurant required-choice enforcement comes from [Module 15 — Structured Business Data](./module-15-structured-business-data.md).
- Payment links are generated via Stripe.

## ✅ Acceptance Criteria
- [ ] A customer can add an item to the cart.
- [ ] A customer can confirm an order.
- [ ] A Stripe / payment link can be generated.
- [ ] A Shopify draft order can be created.
- [ ] A WooCommerce order can be created.
- [ ] A restaurant menu order with modifiers works.

## 🔗 Related
- [Module 15 — Structured Business Data](./module-15-structured-business-data.md)
- [Module 16 — Product & Stock Assistant](./module-16-product-stock-assistant.md)
- [Module 17 — Order Details / Order Tracking](./module-17-order-details-tracking.md)
- [Module 19 — Billing, Plans & Limits](./module-19-billing-plans-limits.md) (Stripe / payment links)
- [Module 24 — Notifications](./module-24-notifications.md) (business notified on order)
- Repo code paths: `src/lib/tools/index.ts`
