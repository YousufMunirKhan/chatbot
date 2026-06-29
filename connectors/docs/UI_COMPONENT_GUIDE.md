# Help Desk UI Component Guide

Company admin controls behavior in Switch&Save. The customer app controls rendering.

## What The Admin Controls

From `/company/help-desk`:

- enabled/disabled
- floating, embedded, or hidden mode
- allowed staff roles
- allowed routes/screens
- blocked routes/screens
- auto-open
- position
- default/contextual/connector-generated pills

## What The Developer Controls

The developer places the UI in the app once:

- Android: Compose/XML/Activity
- .NET: WinForms/WPF/MAUI/Avalonia
- Web: React/Vue/Svelte/plain JS
- Laravel: Blade/Livewire/Inertia/Vue/React

The developer passes:

- current route/screen
- current staff role
- connector token or backend proxy
- navigation callback
- optional theme

## Required UI States

Build these states:

1. Closed bubble
2. Open chat panel
3. Loading answer
4. Assistant answer
5. Quick pills
6. Navigation buttons
7. Guided action form
8. Confirmation step for write actions
9. Error/offline state

## Generic Component Contract

```ts
type HelpdeskChatProps = {
  baseUrl: string;
  token?: string;
  currentRoute: string;
  staffRole: string;
  onOpenRoute: (routeId: string) => boolean | Promise<boolean>;
};
```

## Ask Endpoint

```http
POST /api/helpdesk/chat
Authorization: Bearer hdk_connector_token
Content-Type: application/json
```

```json
{
  "text": "How do I create purchase order?",
  "currentRoute": "purchase/orders",
  "staffRole": "manager"
}
```

Response:

```json
{
  "answer": "Go to Purchase > Purchase Orders > New...",
  "pills": [
    { "label": "Open Purchase Order", "message": "Open purchase order" }
  ],
  "navigationTargets": [
    { "label": "Open Create Purchase Order", "routeId": "purchase_orders.create" }
  ],
  "guidedActions": [
    {
      "name": "update_product_price",
      "requiredFields": ["product_id", "price"],
      "needsConfirmation": true
    }
  ]
}
```

## Visibility Logic

Use the SDK helper where available:

```text
shouldShow(settings, route, role)
```

Rules:

- If disabled or hidden, do not show.
- If role not allowed, do not show.
- If route is blocked, do not show.
- If route is allowed, show.
- Blocked route wins over allowed route.

## Safety

- Do not show Help Desk on public/customer screens.
- Do not expose connector token in public websites.
- Do not run write actions from a single click.
- Always show a confirmation summary for update/create/danger actions.
