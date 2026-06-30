# Auto Discovery Playbook

Use this before editing the platform details file. The starter manifest is only a small sample; a real POS/admin app usually needs many screen docs.

## Goal

Generate one stable `screenDoc` for every staff menu, route, page, form, report, and workflow that the Help Desk should explain or open.

Do not sync the starter sample as production. Replace it with the real app map first.

## What To Scan

- Sidebar, drawer, bottom tabs, toolbar menus, admin menu trees.
- Router files, navigation graphs, Activity/Fragment/Form registrations, controller routes.
- Screen titles, breadcrumbs, labels, buttons, empty states, validation messages.
- Product, stock, order, customer, purchase, invoice, report, settings, sync, terminal, printer, and payment configuration flows.
- Existing deep links, route constants, command names, and permission checks.

## Output Required

For every discovered screen create:

```text
externalKey: stable snake/dot key, for example inventory.add_product
module: top-level area, for example Inventory
screen: screen title, for example Add Product
path: menu path, for example Inventory > Products > Add Product
purpose: one sentence explaining what staff do there
steps: 3-7 factual steps
fields: important inputs/filters with required flags
commonErrors: validation, permission, sync, or empty-result problems
actions: standard action names related to the screen
navigation.routeId: stable ID that can be tested locally
```

## Key Rules

- Never generate random keys. The same screen must keep the same `externalKey` forever.
- Route IDs must be testable before sync.
- If a route cannot be opened yet, set `needsReview: true`.
- Do not include customer/order/product rows, payment data, secrets, API keys, tokens, or connection strings.
- Prefer standard actions from `AI_AGENT_INTEGRATION_PROMPT.md`.

## Route Verification

Before sync, run a local route check for each document with `navigation.routeId`.

Mark each route:

- `verified`: opens the right screen.
- `missing`: no local navigation callback exists.
- `unsafe`: route is login, payment, checkout, customer display, or public/customer-facing.

Only sync verified staff routes as clickable navigation targets.

## AI Agent Task

Ask the AI agent to:

1. Read this playbook.
2. Read the platform-specific AI guide.
3. Inspect the real app's menu/router/screen files.
4. Replace the starter manifest with the discovered screen docs.
5. Add route callbacks for every clickable screen.
6. Add action handlers only where real services exist.
7. Run preview, audit, route verification, then sync.
