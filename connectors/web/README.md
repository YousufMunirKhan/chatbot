# Web Help Desk Connector Starter

Use this for SaaS dashboards, website admin panels, or browser-based business software.

## Where To Run It

Recommended production setup:

- Run the connector token on your web app backend.
- Let your frontend call your own backend.
- Your backend calls the Switch&Save connector API.

This keeps the `hdk_...` connector token out of public browser code.

For internal-only admin panels, `HelpdeskConnectorClient.js` can also run in the browser, but only when the page is authenticated and trusted.

## Example Usage

```js
import { HelpdeskConnectorClient } from './HelpdeskConnectorClient.js';

const connector = new HelpdeskConnectorClient({
  baseUrl: 'https://your-platform-domain.com',
  token: 'hdk_your_token',
  handlers: {
    search_product: async (input) => {
      const results = await yourProductApi.search(input.query);
      return { results };
    },
    daily_sales_report: async (input) => {
      return yourReportsApi.dailySales(input.date);
    },
    update_product_quantity: async (input) => {
      await requireManagerApproval();
      return yourInventoryApi.setQuantity(input.product_id, input.quantity);
    },
  },
});

await connector.runCycle();
```

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
