# Help Desk Connector Starters

These starters are for the first Help Desk Bot MVP:

- `.NET` for Windows POS/local business software.
- `Android` for Android POS/mobile apps.
- `Web` for SaaS dashboards and browser-based admin software.

Read `PROTOCOL.md` for the full cross-platform data flow.

The connector does three jobs:

1. Sync editable help documentation drafts.
2. Sync an approved action manifest.
3. Poll and execute queued events from the bot platform.

The platform stores docs/actions/events only. Live POS data stays in the client app/system.

## What The Developer Builds

The developer does not build the whole connector protocol. They only map their local app functions to action handlers:

```text
search_product -> product service search
check_stock -> inventory service lookup
daily_sales_report -> reporting service
update_product_quantity -> guarded stock update
```

The provided SDK handles token auth, status checks, manifest sync, event polling, result posting, and resync commands.

## Dashboard Setup

1. Open `/company/help-desk`.
2. Create a `.NET` or `Android` connector.
3. Copy the token once.
4. Configure the starter with:

```text
HELPDESK_BASE_URL=https://your-platform-domain.com
HELPDESK_CONNECTOR_TOKEN=hdk_...
```

## API Endpoints

All requests use:

```text
Authorization: Bearer YOUR_CONNECTOR_TOKEN
Content-Type: application/json
```

Endpoints:

```text
GET  /api/helpdesk/connectors/status
POST /api/helpdesk/connectors/sync
GET  /api/helpdesk/connectors/events
POST /api/helpdesk/connectors/events
```

`status` and `events` include:

```json
{
  "manifestRevision": 2,
  "syncRequired": true,
  "commands": [
    { "type": "resync_manifest", "reason": "Dashboard connector configuration changed." }
  ]
}
```

When `syncRequired` is true, the SDK sends the latest documents/actions again.

## Required Action Format

Every action must be named in snake_case and declare risk, roles, fields, and confirmation needs:

```json
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
```

## First POS Actions

Start with these safe actions:

- `search_product`
- `check_stock`
- `low_stock_products`
- `daily_sales_report`
- `end_of_day_report`
- `update_product_quantity`

Keep dangerous actions like refunds, deletes, and invoice edits disabled until role checks and confirmations are fully mature.
