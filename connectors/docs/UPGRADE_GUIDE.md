# Upgrade Guide

Use this when a customer already installed a Help Desk connector and downloads a fresh package.

Do not copy the whole zip over an existing integration without review. Some files are SDK files, but some files are customer-owned mapping files.

Before changing code, open:

- `CONNECTOR_VERSION.json`
- `CHANGELOG.md`
- `events/STANDARD_EVENTS.md`
- `docs/COMPATIBILITY_POLICY.md`

## Safe To Replace

These are framework/SDK files. They are intended to receive updates:

- Android:
  - `HelpdeskConnectorClient.kt`
  - `HelpdeskChatController.kt`
  - `HelpdeskEncryptedTokenStore.kt`
  - `HelpdeskAndroidManifestStore.kt`
  - `HelpdeskConnectorLifecycleObserver.kt`
  - `HelpdeskConnectorPreviewActivity.kt`
- Web/Node:
  - `HelpdeskConnectorClient.js`
  - `HelpdeskEmbeddedChat.js`
  - `HelpdeskDefaultChatUI.js`
- .NET:
  - `StandardHelpdeskEvents.cs`
  - `HelpdeskChatController.cs`
  - `HelpdeskDefaultChatViewModel.cs`
  - connector worker/client files
- Shared events:
  - `events/STANDARD_EVENTS.md`
  - `events/standard-events.json`
  - `events/examples/*.json`
- Laravel:
  - `StandardHelpdeskEvents.php`

## Merge Manually

These files usually contain the customer app's real screens, route IDs, services, and action handlers. Do not overwrite them blindly:

- Android: `HelpdeskAndroidAppDetails.kt`
- Web/Node: `HelpdeskWebAppDetails.js`
- .NET: `HelpdeskDotnetAppDetails.cs`
- Laravel: `HelpdeskLaravelStarter.php` after it has been customized
- Any customer-created `ReportEventHandlers`, `ProductEventHandlers`, `OrderEventHandlers`, `CustomerEventHandlers`, or similar files

If the new package adds new standard actions or helper methods, copy those additions into the existing mapped file without deleting the customer's real screen docs.

## Current Compatibility Notes

- Chat visibility is not blocked by staff role anymore. Staff role is still sent for audit and local action permission checks.
- `allowedRoutes` is optional. Empty means show on staff screens unless blocked.
- `blockedRoutes` still hides Help Desk on login, payment, checkout, customer-facing, and customer-display screens.
- Connector action results now expose `eventId` so chat UIs can poll `/api/helpdesk/events/{eventId}` and show late report/action results.
- `create_purchase_order` is now a standard action. Existing connectors do not need to support it unless the customer app has purchase order functionality.

## Upgrade Steps

1. Commit or back up the existing connector integration.
2. Download the new package.
3. Check `CONNECTOR_VERSION.json` for `breakingChanges`.
4. Read `CHANGELOG.md`.
5. Read `events/STANDARD_EVENTS.md`.
6. Replace SDK files and standard event definition files from the safe list.
7. Manually merge customer-owned mapping and handler files.
8. Keep all existing `externalKey`, `routeId`, and `action.name` values stable.
9. Run Preview.
10. Run Audit.
11. Test route IDs.
12. Sync only after Preview shows the real customer screens.

## What To Ask An AI Agent

Paste this:

```text
Upgrade this Help Desk connector using CONNECTOR_VERSION.json, CHANGELOG.md, events/STANDARD_EVENTS.md, and docs/COMPATIBILITY_POLICY.md. Replace SDK/runtime files and standard event definition files, but do not overwrite customer-owned mapping or handler files. Merge any new helper methods or standard actions into the existing mapping. Preserve all externalKey, routeId, and action.name values. Run preview, audit, and route tests before sync.
```
