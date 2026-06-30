# Help Desk UI Component Guide

Company admin controls behavior in Switch&Save. The customer app controls rendering.

## Default Connector Design

Every connector should start from the same staff Help Desk design:

- top tabs: `Chat` and `History`
- setup/settings button in the top-right
- centered bot icon
- greeting: `Hello {staffName}`
- subtitle: `How can the assistant help you today?`
- quick questions:
  - `How do I add product?`
  - `Check stock`
  - `Update product price`
  - `Create purchase order`
  - `Daily sales report`
- category chips: `For You`, `Products`, `Reports`, `Stock`, `Customers`
- large rounded input: `Ask the assistant anything...`
- send button
- settings panel with route verification

The included helpers implement this baseline:

- Android: `HelpdeskConnectorPreviewActivity.kt` uses the default card design for setup, chat, and route testing.
- Web: `HelpdeskDefaultChatUI.js` mounts the default card design.
- .NET: `HelpdeskDefaultChatViewModel.cs` provides the default questions, categories, route test, and chat actions for WinForms/WPF/MAUI/Avalonia binding.

## What The Admin Controls

From `/company/help-desk`:

- enabled/disabled
- floating, embedded, or hidden mode
- optional route targeting
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
- current staff role for audit/action checks
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
10. Settings/setup panel
11. Route verification success/failure

## Route Verification UI

The settings panel must let the integrator enter a `routeId` and test it before sync.

Expected behavior:

```text
routeId entered -> local route callback runs -> success/failure shown
```

Examples:

- Android: `connector.openNavigationTarget("inventory.products")`
- .NET: `HelpdeskDefaultChatViewModel.TestRoute("inventory.products")`
- Web: `HelpdeskDefaultChatUI.js` Settings -> Test route

If a route fails, tell the developer to add it in the platform details file:

- Android: `HelpdeskAndroidAppDetails.kt -> buildNavigation(...)`
- .NET: `HelpdeskDotnetAppDetails.cs -> OpenRoute(...)`
- Web: `HelpdeskWebAppDetails.js -> openHelpdeskRoute(...)`

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
- If route is blocked, do not show.
- If route targeting is empty, show on staff screens.
- If route targeting is configured, show only on those routes.
- Blocked route wins over allowed route.

Staff role does not hide the chat itself. Use staff role inside local action handlers for update/create/danger permissions.

## Safety

- Do not show Help Desk on public/customer screens.
- Do not expose connector token in public websites.
- Do not run write actions from a single click.
- Always show a confirmation summary for update/create/danger actions.
