# Connector Compatibility Policy

This policy exists so customers can download a newer Help Desk connector without breaking an integration that already works.

The connector package is one package. The important rule is ownership: SDK/runtime files can be replaced, but customer-owned app mapping files must be merged.

Standard event definitions are connector-owned. Customer event handlers are customer-owned.

## Version Contract

- `packageVersion` changes when the downloaded connector package changes.
- `protocolVersion` changes only when the server/connector message contract changes.
- Minor and patch updates must be backward-compatible.
- Breaking changes require a major version and must be listed in `CONNECTOR_VERSION.json` and `CHANGELOG.md`.
- New actions, fields, UI helpers, and endpoints must be additive.
- Existing fields should not be removed. Mark them deprecated first and keep reading them.

## Stable Integration Keys

These values are part of the customer integration contract and should not change once synced:

- `externalKey` for screen documents.
- `routeId` for navigation targets.
- `action.name` for approved action handlers.

If a screen moves in the customer app, keep the same `externalKey` and `routeId`, then update the path, steps, and local navigation callback. That makes resync update the existing Help Desk record instead of creating duplicates.

## Safe To Replace

These files are owned by the connector SDK and are intended to receive future fixes:

- Standard event catalog and platform event definition files.
- HTTP/WebSocket/polling clients.
- Chat controllers and default chat UI/view models.
- Token storage helpers.
- Lifecycle helpers.
- Preview, audit, route-test, and sync helper screens.

## Merge Manually

These files usually contain the customer's real business logic and must not be overwritten blindly:

- `HelpdeskAndroidAppDetails.kt`
- `HelpdeskWebAppDetails.js`
- `HelpdeskDotnetAppDetails.cs`
- `HelpdeskLaravelStarter.php` after customization
- Any local action handler file created by the customer.
- Any route map that opens customer app screens.
- Report, product, order, customer, purchase, invoice, or support event handler classes.

When a new package adds starter examples, copy only the new helper/action definitions that are needed. Keep the customer's existing routes, screen docs, repositories, and handlers.

## Action Compatibility

Standard event/action names are stable. If a better name is introduced later, keep the old action as an alias until customers have had time to migrate.

New standard events should be added to:

- `connectors/events/standard-events.json`
- `connectors/events/STANDARD_EVENTS.md`
- Web: `HelpdeskStandardEvents.js`
- Android: `StandardHelpdeskEvents.kt`
- .NET: `StandardHelpdeskEvents.cs`
- Laravel: `StandardHelpdeskEvents.php`

Do not add customer repository/service code to core connector files.

Write/update/delete/report actions must continue to:

- Validate required fields.
- Respect local app permission checks for the action itself.
- Require confirmation when marked high-risk or write-capable.
- Return small safe JSON, not raw database rows.

## Result Delivery Compatibility

Queued connector events are additive. Newer chat UIs can poll `/api/helpdesk/events/{eventId}` for late results, but existing connectors that only sync documents/actions should still run.

If future delivery changes are needed, keep polling fallback support and keep accepting the previous result payload shape.

## Upgrade Workflow

1. Commit or back up the existing customer integration.
2. Open `CONNECTOR_VERSION.json`.
3. Read `CHANGELOG.md`.
4. Read `docs/UPGRADE_GUIDE.md`.
5. Replace only safe SDK/runtime files.
6. Replace standard event definition files.
7. Merge customer-owned mapping and handler files manually.
8. Preserve `externalKey`, `routeId`, and `action.name`.
9. Run Preview.
10. Run Audit.
11. Test every route ID.
12. Sync.

## AI Agent Instruction

Use this prompt when upgrading with an AI coding tool:

```text
Upgrade the Switch&Save Help Desk connector using the compatibility policy. Replace SDK/runtime files and standard event definition files only. Do not overwrite customer-owned mapping or handler files. Merge new helper methods and action templates into the existing mapped files. Preserve externalKey, routeId, and action.name values. Run preview, audit, route tests, and sync before reporting completion.
```
