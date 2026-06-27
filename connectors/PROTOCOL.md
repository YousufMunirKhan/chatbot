# Switch&Save Help Desk Connector Protocol

This protocol is the same for .NET, Android, and Web connectors.

## What The Connector Sends

The connector sends two safe things to Switch&Save:

1. Help documentation drafts
   - modules
   - screens
   - menu paths
   - purpose
   - steps
   - fields
   - common errors
   - related action names

2. Action manifest
   - action name
   - description
   - type: `read`, `report`, `create`, `update`, or `danger`
   - risk: `low`, `medium`, or `high`
   - required fields
   - optional fields
   - allowed roles
   - whether confirmation is required

It does not send full database tables.

## How The Bot Receives Live Data

Live data is received only through connector events.

```text
User asks a question
Bot checks approved docs and action manifest
Bot queues an event
Connector polls events
Connector runs local handler inside the customer software
Connector sends result JSON
Bot explains the result to the user
```

Example queued event:

```json
{
  "id": "event_uuid",
  "name": "check_stock",
  "input": {
    "product_id": "p_100",
    "branch_id": "main"
  }
}
```

Example connector result:

```json
{
  "eventId": "event_uuid",
  "status": "completed",
  "response": {
    "product_id": "p_100",
    "name": "Pepsi 500ml",
    "quantity": 24,
    "in_stock": true
  }
}
```

## Platform Endpoints

All connector requests use:

```text
Authorization: Bearer hdk_your_connector_token
Content-Type: application/json
```

Endpoints:

```text
GET  /api/helpdesk/connectors/status
POST /api/helpdesk/connectors/sync
GET  /api/helpdesk/connectors/events
POST /api/helpdesk/connectors/events
```

## Platform Differences

### .NET

Best for Windows POS, ERP, inventory tools, and local office software.

Run as a console worker, Windows service, or background job. The connector polls every few seconds and calls local C# services.

### Android

Best for Android POS, delivery, field-service, and mobile business apps.

Run from an app-controlled worker, foreground service, or scheduled background job depending on Android version and app policy.

### Web

Best for SaaS dashboards and browser-based admin software.

Recommended: run the connector token on the web app backend. The frontend talks to your backend; your backend talks to Switch&Save.

## Safety Rules

- Never let the model write SQL.
- Never expose the connector token in a public website.
- Keep dangerous actions disabled until role checks, confirmations, and audit logs are mature.
- For write actions, validate role and confirm the exact change before executing.
- Return only the fields needed for the answer.
- If the connector is offline, the bot can answer from approved docs but cannot claim live values.
