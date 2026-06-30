# Web Help Desk Connector Starter

Use this for SaaS dashboards, website admin panels, or browser-based business software.

## Give This Zip To A Developer Or AI

After unzipping, start with:

1. `AI_IMPLEMENTATION_BRIEF.md` - the short instruction file to paste into Cursor, Claude Code, Codex, or give to a developer.
2. `HelpdeskWebAppDetails.js` - the file to edit with the customer's real admin pages, route URLs, actions, and backend services.
3. `HelpdeskConnectorClient.js` - connector client, preview, audit, sync, polling, and event execution.
4. `HelpdeskDefaultChatUI.js` - default chat/settings card matching the Switch&Save connector design.
5. `HelpdeskEmbeddedChat.js`, React/Vue/Laravel/Node guides - staff-only embedded chat and backend proxy examples.

The starter manifest is only sample data. Production is ready only after `HelpdeskWebAppDetails.js` matches the real admin app.

## Where To Run It

Recommended production setup:

- Run the connector token on your web app backend.
- Let your frontend call your own backend.
- Your backend calls the Switch&Save connector API.

This keeps the `hdk_...` connector token out of public browser code.

For internal-only admin panels, `HelpdeskConnectorClient.js` can also run in the browser, but only when the page is authenticated and trusted.

For embedded staff chat, also read:

- `../docs/UI_COMPONENT_GUIDE.md`
- `../node/AI_AGENT_NODE.md`
- `../react/HELPDESK_REACT_COMPONENT.md`
- `../vue/HELPDESK_VUE_COMPONENT.md`
- `HelpdeskEmbeddedChat.js`

## Where the connector key goes

1. In Switch&Save, open **Company -> Internal Help Desk -> Create connector**.
2. Choose Web and create the connector.
3. Copy the one-time token. It starts with `hdk_`.
4. Put it in your backend environment as `HELPDESK_CONNECTOR_TOKEN`.
5. Put your Switch&Save app URL in `HELPDESK_BASE_URL`, for example `https://chatbot.ssepos.co.uk`.
6. Start your backend worker or call `connector.runCycle()` from a controlled staff/admin process.

Do not place the `hdk_...` token in public website JavaScript. If you use `HelpdeskEmbeddedChat.js`, use it only behind staff auth or call it through your backend.

## How staff open Help Desk

Add a staff-only **Help Desk** item in your admin sidebar. That screen should:

1. Load only for authenticated staff roles.
2. Call your backend chat proxy, not the public website widget API.
3. Pass the current route and staff role.
4. Render navigation buttons from returned route IDs.
5. Run the connector worker on the backend so approved actions can execute locally.

Backend chat proxy:

```js
app.post('/admin/helpdesk/chat', requireStaff, async (req, res) => {
  const response = await fetch(`${process.env.HELPDESK_BASE_URL}/api/helpdesk/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HELPDESK_CONNECTOR_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: req.body.text,
      currentRoute: req.body.currentRoute,
      staffRole: req.user.role,
    }),
  });
  res.status(response.status).json(await response.json());
});
```

Default chat/settings UI:

```js
import { mountHelpdeskDefaultChat } from './HelpdeskDefaultChatUI.js';
import { openHelpdeskRoute } from './HelpdeskWebAppDetails.js';

const client = {
  ask: async (text) => {
    const res = await fetch('/admin/helpdesk/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        currentRoute: router.pathname,
        staffRole: currentUser.role,
      }),
    });
    return res.json();
  },
  openNavigationTarget: (routeId) => openHelpdeskRoute(routeId, router),
};

mountHelpdeskDefaultChat({
  root: document.querySelector('#helpdesk'),
  client,
  currentRoute: router.pathname,
  staffRole: currentUser.role,
  staffName: currentUser.name,
  routeIds: ['dashboard.main', 'inventory.products', 'reports.daily_sales'],
  onOpenRoute: (routeId) => openHelpdeskRoute(routeId, router),
});
```

Use the Settings panel to enter a `routeId` and test it before Sync.

## Example Usage

```js
import { createHelpdeskConnector } from './HelpdeskWebAppDetails.js';

const connector = createHelpdeskConnector({
  productService: yourProductService,
  reportService: yourReportService,
  staffRoleProvider: () => currentStaff.role,
});

console.log(connector.previewManifest());
console.log(connector.auditManifest());
await connector.runCycle();
```

## Node Plug-And-Play Smoke Test

The zip includes `helpdesk-node-starter.mjs`.

```bash
HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk \
HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk \
node helpdesk-node-starter.mjs --once
```

This previews, audits, syncs, and polls one time using sample product/report services. Replace the sample services with the customer's real backend services.

## Laravel Plug-And-Play Starter

The zip includes `HelpdeskLaravelStarter.php`. Copy it to:

```text
app/Services/Helpdesk/HelpdeskLaravelStarter.php
```

It provides `preview()`, `audit()`, `sync()`, `runCycle()`, and `testRoute(...)`. Replace the sample `ProductService` and `ReportService` with real Laravel services or Eloquent queries.

## Connect It To Your Web App

First edit `HelpdeskWebAppDetails.js`:

- add real admin pages/modules
- add real menu paths, steps, fields, and common errors
- map route IDs to `router.push(...)`, redirects, or admin URLs
- keep only actions the backend can safely support
- wire handlers to real backend services

For every page, add:

| Detail | What to enter |
| --- | --- |
| `externalKey` | Stable unique ID, for example `inventory.products`. |
| `module` | Admin area, for example `Inventory`. |
| `screen` | Page name staff recognize. |
| `path` | Menu path, for example `Dashboard > Inventory > Products`. |
| `purpose` | What staff do on this page. |
| `steps` | Click path to complete the task. |
| `fields` | Important fields, required status, and meaning. |
| `commonErrors` | Validation messages or common failure reasons. |
| `actions` | Connector action names related to this page. |
| `navigation.routeId` | Must match a frontend/backend route mapping. |

For every action, add:

| Detail | What to enter |
| --- | --- |
| `name` | Approved snake_case action name, for example `search_product`. |
| `type` | `read`, `create`, `update`, `delete`, `report`, or `danger`. |
| `risk` | `low`, `medium`, or `high`. |
| `requiredFields` | Inputs the bot must provide before the handler runs. |
| `handler` | Real backend service method. |
| `roles` | Staff roles allowed to run it. |
| `confirmation` | Required for write/high-risk actions. |

## What It Does

1. Calls `GET /api/helpdesk/connectors/status`.
2. Sends the current software map with `POST /api/helpdesk/connectors/sync` when sync is required.
3. Polls queued events from `GET /api/helpdesk/connectors/events`.
4. Runs only your mapped local handler for the event name.
5. Posts the result to `POST /api/helpdesk/connectors/events`.

## Data Rule

Do not upload your database. Sync help documentation and approved action names only.

For live facts, return just the answer data needed by the bot, for example:

```json
{
  "results": [
    { "id": "p_100", "name": "Pepsi 500ml", "sku": "PEP500", "quantity": 24 }
  ]
}
```
