# Help Desk Connector Starters

These starters are for the first Help Desk Bot MVP:

- `.NET` for Windows POS/local business software.
- `Android` for Android POS/mobile apps.
- `Web` for SaaS dashboards and browser-based admin software.
- `Node` and `Laravel` guides for backend integrations.

Read `PROTOCOL.md` for the full cross-platform data flow.

For developer onboarding:

- If this came from a downloaded zip, start with `AI_IMPLEMENTATION_BRIEF.md`.
- Start with `HELPDESK_DEVELOPER_HANDOFF.md`.
- Edit the platform details file first:
  - Android: `android/HelpdeskAndroidAppDetails.kt`
  - .NET: `dotnet/HelpdeskDotnetAppDetails.cs`
  - Web/Node/Laravel backend: `web/HelpdeskWebAppDetails.js`
- Use `DEVELOPMENT_TASK_LIST.md` as the implementation roadmap for WebSocket-first delivery, polling fallback, Connector Studio, audits, monitoring, and Android/.NET/Web connector tracks.
- Open `docs/helpdesk-connector-guide.html` for the human-readable connector guide.
- Read `docs/UI_COMPONENT_GUIDE.md` for embedding the staff chat UI.
- Read `docs/CONNECTOR_TEST_PLAN.md` before going live.
- Give `AI_AGENT_INTEGRATION_PROMPT.md` plus the platform-specific AI guide to Codex, Cursor, Claude Code, or another coding agent.
- Platform AI guides:
  - `android/AI_AGENT_ANDROID.md`
  - `android/ANDROID_UI_GUIDE.md`
  - `web/AI_AGENT_WEB.md`
  - `dotnet/AI_AGENT_DOTNET.md`
  - `dotnet/WINFORMS_WPF_UI.md`
  - `node/AI_AGENT_NODE.md`
  - `laravel/AI_AGENT_LARAVEL.md`
  - `react/HELPDESK_REACT_COMPONENT.md`
  - `vue/HELPDESK_VUE_COMPONENT.md`

The connector does three jobs:

1. Sync editable help documentation drafts.
2. Sync an approved action manifest.
3. Receive queued events by WebSocket, with polling fallback, and execute local handlers.

The platform stores docs/actions/events only. Live POS data stays in the client app/system.

## What The Developer Builds

The developer does not build the whole connector protocol. They fill the platform details file with real screens/pages/forms, route IDs, and action handlers:

```text
screen/page/form -> connector document
routeId -> local navigation command/router URL
search_product -> product service search
check_stock -> inventory service lookup
daily_sales_report -> reporting service
update_product_quantity -> guarded stock update
```

The provided SDK handles token auth, status checks, manifest sync, event polling, result posting, and resync commands.

## Dashboard Setup

1. Open `/company/help-desk`.
2. Create an `Android`, `.NET`, or `Web` connector.
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
POST /api/helpdesk/chat
WS   /api/helpdesk/connectors/socket
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

Every action must be named in snake_case and declare risk, fields, confirmation needs, and optional local role hints:

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

Keep dangerous actions like refunds, deletes, and invoice edits disabled until local safety checks, confirmations, and audit logs are mature.
