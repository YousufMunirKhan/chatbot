# Help Desk Bot Launch Plan

## Product Position

Help Desk Bot is an AI help layer for a customer's own software. It teaches users how the software works and can trigger approved actions through a connector.

Core promise:

- We do not store the customer's database records.
- We store reviewed help documentation, workflow text, and approved action definitions.
- Live searches, reports, and updates run through the customer's connector.

## Bot Model

Help Desk Bot = Reviewed Docs + Action Manifest + Connector Events

Reviewed Docs answer:

- How do I add a product?
- Where is the daily sales report?
- What does this menu option do?
- Why am I getting this error?

Action Manifest enables:

- `search_product`
- `check_stock`
- `update_product_quantity`
- `low_stock_products`
- `daily_sales_report`
- `end_of_day_report`
- `search_invoice`
- `create_customer`
- `create_product`

Connector Events execute:

- Read actions return live data from the customer's system.
- Write actions require permission and confirmation before execution.
- Results are returned to the chatbot as structured data.

## Launch Scope

### Phase 1: Connector Documentation Sync

Goal: make the bot understand the customer's software without database upload.

Build:

- Connector registration screen in the dashboard.
- Download cards for Web SDK, .NET connector, and Android SDK.
- Documentation upload/sync endpoint.
- Review screen before publishing generated docs.
- Store approved docs into the existing knowledge base.

Connector sync payload:

```json
{
  "platform": "dotnet",
  "app_name": "POS System",
  "module": "Inventory",
  "screen": "Stock Adjustment",
  "path": "Inventory > Stock Adjustment",
  "purpose": "Used to update product stock quantity.",
  "steps": [
    "Open Inventory",
    "Open Stock Adjustment",
    "Search product",
    "Enter new quantity",
    "Save"
  ],
  "common_errors": [
    "Quantity cannot be negative",
    "Only admin can update stock"
  ],
  "actions": ["search_product", "update_product_quantity"]
}
```

### Phase 2: Action Manifest

Goal: let customers approve exactly what the bot can do.

Tables needed:

- `connectors`
- `connector_actions`
- `connector_action_fields`
- `connector_event_logs`
- `connector_sync_jobs`

Action definition:

```json
{
  "name": "update_product_quantity",
  "description": "Update stock quantity for one product",
  "type": "write",
  "risk": "medium",
  "required_fields": ["product_name", "quantity"],
  "optional_fields": ["branch_id"],
  "needs_confirmation": true,
  "allowed_roles": ["admin", "inventory_manager"]
}
```

Action categories:

- Read: search, check, list, report.
- Create: create product, create customer, create ticket.
- Update: update stock, update price, update customer phone.
- Dangerous: delete, refund, cancel, edit closed invoice.

V1 should allow read actions and medium-risk updates. Dangerous actions should stay disabled until audit logging, permissions, and confirmation are mature.

### Phase 3: Runtime Event Bridge

Goal: chatbot can call actions without touching the customer's database directly.

Flow:

```text
User asks action
AI selects approved action
Backend validates fields, role, and risk
Bot asks confirmation if needed
Backend dispatches event to connector
Connector executes inside customer system
Connector returns result
Bot replies with success, failure, or next question
```

API routes:

- `POST /api/connectors/register`
- `POST /api/connectors/sync-docs`
- `GET /api/connectors/actions`
- `POST /api/connectors/actions`
- `POST /api/connectors/events/dispatch`
- `POST /api/connectors/events/result`
- `GET /api/connectors/status`

### Phase 4: Platform Connectors

Web SDK:

- JavaScript or NPM package.
- Best for SaaS dashboards and admin panels.
- Can register routes, screens, help docs, and frontend events.

.NET Connector:

- NuGet package or Windows service.
- Best for POS, ERP, inventory, and local Windows software.
- Can expose approved local actions without database upload.

Android SDK:

- Android library.
- Best for mobile POS, delivery apps, and field apps.
- Can register app screens and action handlers.

All connectors must output the same protocol:

- Documentation sync payloads.
- Action manifest payloads.
- Event result payloads.

## Dashboard Changes

Help Desk page should become:

- Connector status.
- Download connector/SDK cards.
- Last sync time.
- Synced docs awaiting review.
- Approved software modules.
- Approved actions.
- Recent event logs.
- Failed event logs.

Bot settings should separate:

- Customer-facing assistant.
- Internal help desk assistant.

Help Desk Bot should not be treated like a public website widget by default. It should be embedded inside the customer's software or used through an authenticated internal URL.

## Prompt Rules

Internal help desk prompt must say:

- Answer workflow questions only from approved connector docs and knowledge.
- For live facts, use connector actions only.
- Never claim a stock, report, order, or customer value unless the connector returned it.
- Never write SQL.
- Never ask the customer to upload database records.
- Before write actions, summarize the action and ask explicit confirmation.
- If the connector is offline, explain that live actions are unavailable.

## Cost Controls

Supabase:

- Store docs and manifests, not live operational records.
- Use count queries for readiness dashboards.
- Add indexes on `company_id`, connector id, action name, and created time.
- Keep event logs summarized and retention-limited.
- Avoid storing large screenshots by default; store compressed images only when needed.

AI:

- Do not call AI during normal connector setup checks.
- Use deterministic validation for missing docs/actions.
- Chunk and embed only reviewed documentation.
- Keep action manifests as structured JSON, not long prompt text.
- Inject only relevant docs through retrieval.
- Use tool calls for live data instead of sending large datasets into the model.
- Cache repeated help answers where safe.
- Put daily report generation in connector/backend code, not in the LLM.

## Launch Order

1. Finish Customer Bot readiness and launch checklist.
2. Build Help Desk connector tables and dashboard shell.
3. Build manual docs sync and review flow.
4. Build action manifest management.
5. Build event dispatch and logs.
6. Release Web SDK first for easiest testing.
7. Release .NET connector for POS/local systems.
8. Release Android SDK after the protocol is stable.

