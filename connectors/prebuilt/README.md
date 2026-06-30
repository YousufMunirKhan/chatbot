# Pre-built connectors (turnkey)

Drop-in connectors that map the standard Help Desk actions to a specific
platform's API — so a customer can go live **without writing integration code**,
only providing credentials. They build on the same Web SDK
(`connectors/web/HelpdeskConnectorClient.js`) that powers custom connectors.

| Platform | Folder | Actions wired |
|----------|--------|---------------|
| Shopify  | [`shopify/`](shopify/connector.mjs) | search_product, get_product, check_stock, low_stock_products |
| Square   | [`square/`](square/connector.mjs)   | search_product, get_product, check_stock |
| Foodics  | [`foodics/`](foodics/connector.mjs) | search_product, get_product, daily_sales_report |

## How it works

1. Create a connector in the Help Desk dashboard → copy its `hdk_…` token.
2. Set the env vars listed at the top of the platform's `connector.mjs`.
3. Run it: `node connectors/prebuilt/<platform>/connector.mjs`
   (Node 18+; deploy as a small always-on worker / container / cron).
4. It syncs its manifest, then polls for events and answers them by calling the
   platform API. Real-time delivery upgrades automatically when the WebSocket
   gateway is reachable (`npm run dev:helpdesk-ws`).

## Give This Folder To A Developer Or AI

Use this when the customer uses Shopify, Square, or Foodics and wants a faster setup than a custom app connector.

Tell Cursor, Claude Code, Codex, or the developer:

1. Open `connectors/prebuilt/<platform>/connector.mjs`.
2. Read the `Required env` block at the top.
3. Add the customer's platform API credentials to environment variables.
4. Keep `HELPDESK_CONNECTOR_TOKEN` and platform API tokens server-side only.
5. Run the connector as a backend worker, container, Windows service, or cron-managed process.
6. Test `syncManifest()`, then let `runCycle()` poll events.
7. Extend the `handlers` map only for actions the platform account/API scope can safely support.

For each prebuilt connector, an AI agent should verify:

- required API scopes are documented and present
- action names match `standardActionLibrary()`
- result JSON is small and does not expose full customer/order databases
- write actions keep `needsConfirmation: true`
- missing credentials fail with a clear message
- platform API errors are surfaced in connector health/log output

## Status & scope

These are **production-shaped scaffolds**: the API calls hit each platform's real
REST endpoints and the action manifests are valid. To run end-to-end they need a
real merchant account + API credentials for that platform — that part can't be
bundled here. Extend the `handlers` map to cover more actions (orders, customers,
price/stock writes) as needed; writes should keep `needsConfirmation: true`.
