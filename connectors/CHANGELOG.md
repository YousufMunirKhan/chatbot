# Help Desk Connector Changelog

## 0.4.0

Compatibility: backward-compatible.

Added:

- `CONNECTOR_VERSION.json` in downloaded packages.
- Connector compatibility policy and stronger upgrade guidance.
- Shared standard event catalog under `events/`.
- Platform event definition files for Web, Android, .NET, and Laravel.
- Event result polling support so queued reports/actions can show final chat results.
- `create_purchase_order` standard action template.
- Expanded starter screen docs for product, order, customer, purchase order, reports, and settings flows.
- Auto-discovery playbook so AI tools can scan the real customer app instead of shipping starter-only docs.
- Default staff Help Desk chat/setup UI guidance for connector packages.

Changed:

- Help Desk chat visibility no longer blocks by staff role. If the customer app opens Help Desk for staff, the chat can appear unless a route is explicitly blocked.
- Empty `allowedRoutes` means the Help Desk can appear on staff screens except blocked routes.
- Connector docs are packaged under `docs/` in downloaded zip files.
- Existing standard action helpers now delegate to connector-owned event definition files where supported.

Upgrade notes:

- Replace SDK/runtime files from the safe list.
- Replace standard event definition files from the safe list.
- Manually merge customer-owned mapping files.
- Preserve existing `externalKey`, `routeId`, and `action.name` values.
- Existing connectors do not need to implement `create_purchase_order` unless the customer app supports purchase orders.

Breaking changes:

- None.

## 0.3.0

Compatibility: backward-compatible.

Added:

- Preview, audit, sync, and route-test guidance for platform connector packages.
- Android, .NET, Web, Node, Laravel, React, and Vue starter documentation.
- Upgrade guide for existing integrations.

Breaking changes:

- None.
