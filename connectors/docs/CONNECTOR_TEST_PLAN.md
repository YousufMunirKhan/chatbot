# Connector Test Plan

Run these tests before marking an integration complete.

## Manifest Sync

- [ ] Preview shows all expected modules/screens.
- [ ] Every document has module, screen, path, purpose, and steps.
- [ ] Every clickable screen has a route ID.
- [ ] Audit has no blockers.
- [ ] Sync succeeds.
- [ ] Docs appear in Switch&Save dashboard.
- [ ] Company admin can edit, approve, or ignore draft docs in the dashboard.

## Chat Visibility

- [ ] Chat shows on an allowed route.
- [ ] Chat hides on a blocked route.
- [ ] Chat hides for an unauthorized role.
- [ ] Chat hides on login/payment/checkout/customer-display screens.
- [ ] Chat works after app navigation changes.

## Staff Chat

- [ ] Staff asks a how-to question.
- [ ] Bot answers from approved docs.
- [ ] Quick pills appear.
- [ ] Navigation button appears for mapped screens.
- [ ] Clicking navigation opens the correct screen.

## Actions

- [ ] `search_product` returns safe product summaries.
- [ ] `check_stock` returns stock for one product.
- [ ] `daily_sales_report` returns summary only.
- [ ] Write action without confirmation fails.
- [ ] Dry-run write action validates but does not update the database.
- [ ] Write action with confirmation succeeds.
- [ ] Result payload does not include secrets or large records.
- [ ] Help Desk audit log shows question, action, confirmation, dry-run flag, status, and result/error.

## Delivery

- [ ] WebSocket connects when configured.
- [ ] Polling fallback works when WebSocket is unavailable.
- [ ] Reconnect/backoff works.
- [ ] Health logs appear in dashboard.
- [ ] Missing handler is logged clearly.

## Customer Safety

- [ ] Customer/public widget does not show Help Desk chat.
- [ ] Customer bot cannot see internal pills.
- [ ] Customer bot cannot retrieve internal connector docs.
- [ ] Connector token is not exposed on public pages.
