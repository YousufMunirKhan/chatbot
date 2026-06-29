# Help Desk Connector Development Task List

This is the implementation checklist for the Help Desk Connector platform. The goal is to make Android, .NET, and Website connectors reliable, easy to integrate with AI coding agents, safe for customer systems, and fully observable from our server.

## Principles

- WebSocket is the primary live delivery mode for private/local connectors.
- Safe polling is fallback only, not the main design.
- Direct API is preferred when the customer has a secure reachable backend.
- The connector never uploads full customer databases.
- Live product, stock, customer, invoice, order, and report data stays inside the customer system.
- Our server stores connector docs, action manifests, event logs, health logs, delivery mode, metrics, and summarized action results.
- Write/update/danger actions require explicit confirmation; local role validation is optional if the customer app already has it.
- Android, .NET, and Website connectors should share one protocol and one action library.
- Connector work must not impact the customer support bot. Internal Help Desk is a separate mode with separate knowledge/tool access.

## Non-Negotiable Customer Bot Isolation

- [ ] Customer-facing support bots must never receive internal connector docs.
- [ ] Customer-facing support bots must never receive `run_helpdesk_action` or connector action tools.
- [ ] Customer-facing support bots must never show internal navigation paths, admin screens, POS screens, report screens, or staff-only workflow docs.
- [ ] Customer-facing support bots must continue using only customer-safe knowledge, public business facts, customer-safe product/order tools, and human handoff.
- [ ] Internal Help Desk bots may use internal connector docs, action manifests, local connector actions, and clickable software paths.
- [ ] Connector docs must sync with `audience = internal` unless explicitly marked `both` by an admin-reviewed workflow.
- [ ] Direct API, WebSocket, and polling fallback action execution must be available only to internal Help Desk mode unless a separate customer-safe integration is explicitly built.
- [ ] Any new connector tool must declare allowed audiences and default to internal-only.
- [ ] Any new retrieval query must respect audience filtering: customer bots see `customer` and `both`; internal bots may see `internal`, `customer`, and `both`.
- [ ] Add regression tests proving customer bots cannot retrieve internal connector docs.
- [ ] Add regression tests proving customer bots cannot call connector actions.
- [ ] Add dashboard labels that clearly distinguish Customer Bot from Internal Help Desk Bot.
- [ ] Add deployment checklist item: test one customer bot conversation after connector changes.

## Phase 1: Shared Connector Protocol

- [ ] Define delivery modes: `direct_api`, `websocket`, `polling_fallback`, `manual`.
- [ ] Add connector capability fields for supported delivery modes.
- [ ] Add connector preferred mode and active mode tracking.
- [ ] Add connector heartbeat payload shape.
- [ ] Add event acknowledgement payload shape.
- [ ] Add action result payload shape with latency, status, and error metadata.
- [ ] Add safe result size limits.
- [ ] Add redaction rules for sensitive fields.
- [ ] Add standard retry and timeout rules.
- [ ] Document protocol examples for Android, .NET, and Website connectors.

## Phase 2: Server Database And Logging

- [ ] Extend `helpdesk_connectors` with:
  - `preferred_delivery_mode`
  - `active_delivery_mode`
  - `last_connected_at`
  - `last_disconnected_at`
  - `last_poll_at`
  - `poll_interval_seconds`
  - `fallback_reason`
  - `connection_state`
- [ ] Create `helpdesk_connector_health_logs`.
- [ ] Log `websocket_connected`.
- [ ] Log `websocket_disconnected`.
- [ ] Log `websocket_reconnect_attempt`.
- [ ] Log `websocket_reconnect_failed`.
- [ ] Log `fallback_started`.
- [ ] Log `fallback_stopped`.
- [ ] Log `poll_attempt`.
- [ ] Log `poll_success`.
- [ ] Log `poll_failed`.
- [ ] Log `event_delivered`.
- [ ] Log `event_acknowledged`.
- [ ] Log `event_completed`.
- [ ] Log `event_failed`.
- [ ] Log `handler_missing`.
- [ ] Log `handler_timeout`.
- [ ] Log `sync_started`.
- [ ] Log `sync_completed`.
- [ ] Log `sync_failed`.
- [ ] Build a connector metrics query/view for dashboard cards.

## Phase 3: Server WebSocket Gateway

- [ ] Add connector WebSocket endpoint, for example `/api/helpdesk/connectors/socket`.
- [ ] Authenticate connector with `Authorization: Bearer hdk_...`.
- [ ] Reject revoked or paused connectors.
- [ ] Register active socket by connector id.
- [ ] Record connection metadata: IP, user agent, app version, platform.
- [ ] Send queued events through the socket when available.
- [ ] Require connector acknowledgement for delivered event.
- [ ] Mark event `running` only after acknowledgement.
- [ ] Receive action result over WebSocket.
- [ ] Update event as completed, failed, or cancelled.
- [ ] Handle duplicate delivery safely.
- [ ] Handle reconnect and resume uncompleted events.
- [ ] Add server-side ping/pong heartbeat.
- [ ] Add idle timeout and cleanup for dead sockets.
- [ ] Fallback to queued state if socket delivery fails.

## Phase 4: Polling Fallback

- [ ] Keep current event polling route as fallback.
- [ ] Add connector-reported fallback reason.
- [ ] Default interval to 60 seconds.
- [ ] Add idle backoff to 2-5 minutes.
- [ ] Add max events per poll.
- [ ] Add max poll frequency enforcement server-side.
- [ ] Record every poll attempt.
- [ ] Record events returned count.
- [ ] Record duration and next poll time.
- [ ] Ensure polling checks only our server and does not scan customer DB.
- [ ] Add dashboard indicator when fallback is active.

## Phase 5: Direct API Execution Mode

- [ ] Define direct API action configuration.
- [ ] Store endpoint, method, auth type, headers, and timeout in encrypted settings.
- [ ] Add direct API action executor on our server.
- [ ] Add per-action allowlist and payload schema validation.
- [ ] Add response mapping and redaction.
- [ ] Add direct API health checks.
- [ ] Log direct API request metadata without storing secrets.
- [ ] Let actions choose direct API when customer backend is secure and reachable.

## Phase 6: Connector Studio Core

- [ ] Build local manifest model with documents, actions, navigation, and review state.
- [ ] Add local save file/config.
- [ ] Add preview view for screens/docs.
- [ ] Add preview view for actions.
- [ ] Add preview view for navigation targets.
- [ ] Add change detection: new, updated, removed, unchanged.
- [ ] Add local edit support for module, screen, path, purpose, steps, fields, common errors.
- [ ] Add local edit support for action risk, fields, roles, confirmation, enabled state.
- [ ] Add local edit support for route IDs, deep links, URLs, and commands.
- [ ] Add advanced JSON export only as secondary view.
- [ ] Add `preview`, `audit`, `save`, `sync`, and `run-cycle` commands or UI actions.

## Phase 7: Connector Audit Engine

- [ ] Validate connector manifest schema.
- [ ] Validate unique `externalKey`.
- [ ] Validate unique action names.
- [ ] Validate unique route IDs.
- [ ] Validate action names are snake_case.
- [ ] Validate every enabled action has a local handler.
- [ ] Validate every write/create/update/danger action requires confirmation.
- [ ] Validate dangerous actions are disabled by default.
- [ ] Validate every navigation button has route/URL/command/deep link or is marked unavailable.
- [ ] Detect possible secrets: token, password, API key, connection string, private key.
- [ ] Detect payment/card terms: card number, CVV, expiry, PIN.
- [ ] Detect large database-like sample records.
- [ ] Warn for missing purpose.
- [ ] Warn for short or missing steps.
- [ ] Warn for missing local role hints only when the target app uses role-based actions.
- [ ] Block sync when critical audit checks fail.
- [ ] Send audit summary to server during sync.

## Phase 8: Standard Action Library

- [ ] Define shared action templates:
  - `search_product`
  - `get_product`
  - `create_product`
  - `update_product`
  - `update_product_price`
  - `update_product_quantity`
  - `disable_product`
  - `check_stock`
  - `low_stock_products`
  - `stock_adjustment_history`
  - `search_customer`
  - `create_customer`
  - `update_customer`
  - `update_customer_phone`
  - `search_order`
  - `get_order_status`
  - `create_order`
  - `cancel_order`
  - `search_invoice`
  - `get_invoice`
  - `daily_sales_report`
  - `end_of_day_report`
  - `stock_value_report`
  - `create_support_ticket`
  - `add_customer_note`
- [ ] Define standard required/optional fields for each action.
- [ ] Define default type, risk, and confirmation rules.
- [ ] Define default result shape for each action.
- [ ] Build action library UI in Connector Studio.
- [ ] Show connection status: connected, missing handler, disabled, blocked.
- [ ] Allow custom actions with strict audit rules.

## Phase 9: Dashboard Monitoring

- [ ] Add connector live status card.
- [ ] Show preferred delivery mode.
- [ ] Show active delivery mode.
- [ ] Show WebSocket connected/disconnected state.
- [ ] Show fallback reason.
- [ ] Show poll interval and last poll.
- [ ] Show polls in last 24h.
- [ ] Show events executed in last 24h.
- [ ] Show average action latency.
- [ ] Show failure rate.
- [ ] Show last action and status.
- [ ] Show connector timeline.
- [ ] Show sync/audit status.
- [ ] Show warnings and blockers from latest audit.
- [ ] Add filters for event logs by connector, action, status, and delivery mode.

## Phase 10: Alerts And Controls

- [ ] Alert when connector offline for more than 10 minutes.
- [ ] Alert when fallback polling active for more than 30 minutes.
- [ ] Alert when action failure rate is high.
- [ ] Alert when handler is missing.
- [ ] Alert when sync fails.
- [ ] Alert when dangerous action is attempted.
- [ ] Add admin control to pause connector.
- [ ] Add admin control to revoke connector token.
- [ ] Add admin control to force resync.
- [ ] Add max action runtime.
- [ ] Add max result payload size.
- [ ] Add per-connector event rate limits.

## .NET Connector Track

- [ ] Build .NET WebSocket client.
- [ ] Authenticate with connector token.
- [ ] Implement reconnect with backoff.
- [ ] Implement polling fallback after WebSocket failure.
- [ ] Implement health log reporting.
- [ ] Implement action handler registry.
- [ ] Implement navigation command registry.
- [ ] Implement standard action library templates.
- [ ] Implement local Connector Studio console first.
- [ ] Add optional WinForms/WPF Connector Studio UI later.
- [ ] Add local manifest save file.
- [ ] Add manifest diff detection.
- [ ] Add audit command.
- [ ] Add sync command.
- [ ] Add event acknowledgement.
- [ ] Add action result posting.
- [ ] Add handler timeout.
- [ ] Add optional local role validation examples.
- [ ] Add examples for POS service integration.
- [ ] Add examples for command navigation such as `OpenAddProductScreen`.
- [ ] Add Windows service deployment notes.

## Android Connector Track

- [x] Build Android WebSocket client for active app sessions.
- [x] Connect only while staff app/helpdesk screen is active.
- [x] Close WebSocket when app is backgrounded.
- [x] Add reconnect with backoff while active.
- [x] Add manual refresh or safe active-session polling fallback.
- [ ] Plan FCM push wake-up as future mode.
- [x] Implement action handler registry.
- [x] Implement navigation route/deep-link registry.
- [x] Implement standard action library templates.
- [x] Add preview/audit debug screen.
- [x] Add local manifest save storage.
- [x] Add manifest diff detection.
- [x] Add audit command/screen.
- [x] Add sync action.
- [x] Add event acknowledgement.
- [x] Add action result posting.
- [x] Add handler timeout.
- [x] Add encrypted token storage.
- [x] Add optional local role validation examples.
- [x] Add examples for Jetpack Compose navigation.
- [x] Add examples for Activity/Fragment navigation.
- [x] Add examples for deep links.

Android source-kit status: the connector starter now includes these pieces in `connectors/android`. Android Studio compile/runtime verification still must happen inside the target Android app because repository services, navigation objects, lifecycle owners, and approved dependency versions are app-specific.

## Website Connector Track

- [ ] Build backend connector service for customer web apps.
- [ ] Keep connector token server-side only.
- [ ] Support direct API mode for cloud apps.
- [ ] Support backend WebSocket mode if needed.
- [ ] Support slow fallback polling from backend job if needed.
- [ ] Implement admin Connector Studio page.
- [ ] Build route/menu scanner helpers for common web stacks.
- [ ] Build action handler registry.
- [ ] Build navigation URL registry.
- [ ] Implement standard action library templates.
- [ ] Add local/server-side manifest save.
- [ ] Add manifest diff detection.
- [ ] Add audit route.
- [ ] Add sync route.
- [ ] Add event acknowledgement.
- [ ] Add action result posting.
- [ ] Add handler timeout.
- [ ] Add authenticated staff checks.
- [ ] Add examples for Next.js.
- [ ] Add examples for React Router.
- [ ] Add examples for backend service handlers.

## Testing

- [ ] Unit test manifest validation.
- [ ] Unit test action audit rules.
- [ ] Unit test secret detection.
- [ ] Unit test navigation validation.
- [ ] Unit test delivery mode selection.
- [ ] Integration test WebSocket event delivery.
- [ ] Integration test WebSocket reconnect.
- [ ] Integration test fallback polling.
- [ ] Integration test direct API execution.
- [ ] Integration test event acknowledgement.
- [ ] Integration test action completion.
- [ ] Integration test handler missing.
- [ ] Integration test timeout handling.
- [ ] Integration test dashboard metrics.
- [ ] Load test many idle WebSocket connectors.
- [ ] Load test fallback polling rate limits.
- [ ] Verify customer bot cannot access internal connector docs/actions.

## MVP Build Order

1. Database logging and connector status fields.
2. Server WebSocket gateway.
3. .NET WebSocket connector with polling fallback.
4. Shared health logs and dashboard status.
5. Standard action library.
6. Connector Studio console preview/audit/save/sync.
7. Android active-session WebSocket connector.
8. Website backend connector/direct API mode.
9. Dashboard monitoring timeline.
10. Alerts and controls.
