# AI Agent Integration Prompt

Copy this file into Codex, Cursor, Claude Code, or another coding agent together with the target app's route/menu/screen/action files. The AI agent should generate or update the Help Desk connector integration without uploading real customer records.

## Goal

Integrate the Switch&Save Help Desk Connector into this software so an internal staff assistant can:

1. Answer staff how-to questions from approved software documentation.
2. Show clickable navigation targets for known screens.
3. Run approved local actions such as product search, stock checks, reports, and safe updates.
4. Preview, audit, save, and sync the connector manifest.

The connector must not upload full database tables, customer records, invoices, passwords, tokens, payment data, or secrets.

## Build These Pieces

1. A local software map builder.
2. A connector manifest with `documents` and `actions`.
3. Local action handlers for supported actions.
4. Navigation handlers for clickable paths where the app supports them.
5. A preview/editor surface or readable local preview output.
6. An audit step that blocks unsafe or incomplete syncs.
7. A sync step that sends only reviewed docs/actions to Switch&Save.

## Manifest Shape

Return a manifest shaped like this:

```json
{
  "appVersion": "1.0.0",
  "clientRevision": 1,
  "documents": [
    {
      "externalKey": "inventory.add_product",
      "module": "Inventory",
      "screen": "Add Product",
      "path": "Inventory > Products > Add Product",
      "purpose": "Create a new product in the POS.",
      "steps": [
        "Open Inventory.",
        "Open Products.",
        "Choose Add Product.",
        "Enter product name, SKU, price, and opening stock.",
        "Save the product."
      ],
      "fields": [
        {
          "name": "product_name",
          "required": true,
          "description": "Name shown to staff and reports."
        }
      ],
      "commonErrors": [
        "SKU already exists: choose a unique SKU.",
        "Price is required: enter a valid selling price."
      ],
      "actions": ["search_product", "create_product"],
      "navigation": {
        "label": "Open Add Product",
        "routeId": "inventory.add_product",
        "platformTargets": {
          "android": {
            "route": "inventory/products/new",
            "deepLink": "mypos://inventory/products/new"
          },
          "web": {
            "url": "/inventory/products/new"
          },
          "dotnet": {
            "command": "OpenAddProductScreen",
            "uri": "mypos://inventory/products/new"
          }
        }
      },
      "needsReview": false
    }
  ],
  "actions": [
    {
      "name": "update_product_quantity",
      "description": "Update stock quantity for one product.",
      "type": "update",
      "risk": "medium",
      "requiredFields": ["product_id", "quantity"],
      "optionalFields": ["reason"],
      "allowedRoles": ["admin", "manager"],
      "needsConfirmation": true
    }
  ]
}
```

The platform accepts `navigation` and `needsReview` in connector document payloads. Connector Studio should still keep a local saved copy so developers can preview, edit, audit, and compare changes before syncing.

Important: `allowedRoles` is only a local app hint for now. Do not build a complex Switch&Save role matrix for the first integration. The MVP safety model is:

- company admin enables/disables each action in the dashboard
- create/update/danger/non-low-risk actions always require one explicit confirmation
- use `_dryRun: true` for sandbox tests
- every chat/action/result is logged in the Help Desk audit trail

## Standard Action Library

Prefer these action names so the Help Desk Bot can learn consistent behavior across customers:

| Area | Action | Type | Risk | Confirmation |
| --- | --- | --- | --- | --- |
| Products | `search_product` | read | low | no |
| Products | `get_product` | read | low | no |
| Products | `create_product` | create | medium | yes |
| Products | `update_product` | update | medium | yes |
| Products | `update_product_price` | update | medium | yes |
| Products | `update_product_quantity` | update | medium | yes |
| Products | `disable_product` | update | high | yes |
| Stock | `check_stock` | read | low | no |
| Stock | `low_stock_products` | report | low | no |
| Stock | `stock_adjustment_history` | report | low | no |
| Customers | `search_customer` | read | low | no |
| Customers | `create_customer` | create | medium | yes |
| Customers | `update_customer` | update | medium | yes |
| Customers | `update_customer_phone` | update | medium | yes |
| Orders | `search_order` | read | low | no |
| Orders | `get_order_status` | read | low | no |
| Orders | `create_order` | create | medium | yes |
| Orders | `cancel_order` | danger | high | yes |
| Invoices | `search_invoice` | read | low | no |
| Invoices | `get_invoice` | read | low | no |
| Reports | `daily_sales_report` | report | low | no |
| Reports | `end_of_day_report` | report | low | no |
| Reports | `stock_value_report` | report | low | no |
| Support | `create_support_ticket` | create | low | no |
| Support | `add_customer_note` | create | medium | yes |

Danger actions must be disabled or marked unavailable unless the app has strong local role checks, audit logs, and explicit confirmation.

## Audit Rules

Before syncing, implement an audit that checks:

- Every document has `externalKey`, `module`, `screen`, `path`, `purpose`, and useful steps.
- Every `externalKey`, action name, and `routeId` is unique.
- Action names are snake_case.
- Every enabled action has a local handler.
- Every write, create, update, danger, or non-low-risk action requires confirmation.
- Dangerous actions are disabled for the first integration unless explicitly approved.
- Every clickable navigation target has a registered handler, route, URL, URI, or deep link.
- No text contains obvious secrets such as password, token, API key, connection string, card number, CVV, or private key.
- No synced document includes database rows, customer lists, invoice lists, or large sample datasets.
- Connector token is stored securely and never exposed in a public website.

## Preview Requirements

The connector should show a human-readable preview before sync:

- Documents grouped by module and screen.
- Screen path and clickable navigation target.
- Steps, fields, and common errors.
- Related actions.
- Action library connection status.
- Audit passed, warnings, and blocked issues.
- New, updated, removed, and unchanged items since last save.

Do not show raw JSON as the main experience. JSON can be available only as an advanced/export view.

## Sync Rules

The connector should have these local commands or UI actions:

```text
preview
audit
save
sync
run-cycle
```

`save` stores the edited local manifest. `sync` sends it to Switch&Save as draft docs/actions. Switch&Save company admins still review and approve docs before the bot can use them.

For sandbox tests, include `_dryRun: true` in the action input and make the local handler validate without writing to the database.

## Platform-Specific Tasks

After reading this file, also read the relevant platform prompt:

- `connectors/android/AI_AGENT_ANDROID.md`
- `connectors/web/AI_AGENT_WEB.md`
- `connectors/dotnet/AI_AGENT_DOTNET.md`
