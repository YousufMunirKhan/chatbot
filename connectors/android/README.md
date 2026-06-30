# Android Help Desk Connector Starter

Use these files inside an Android POS or mobile business app. The Android connector keeps customer data inside the app and only syncs reviewed help docs, action metadata, health logs, and action results.

## ⚡ Quick start (the whole thing in one file)

New here? Open **[`HelpdeskQuickStartExample.kt`](HelpdeskQuickStartExample.kt)** — it shows the complete wiring end-to-end with comments. The 5 steps:

1. **Save the token** — `HelpdeskEncryptedTokenStore(context).saveToken("hdk_…")` (once).
2. **Map navigation** — tell the bot how to open your screens.
3. **Register actions** — pick a `standardActionLibrary()` definition + write a one-line handler against your repository. The SDK validates required fields, role, and `confirmed` for you.
4. **Create** `HelpdeskConnectorClient(...)`.
5. **Attach** `HelpdeskConnectorLifecycleObserver` so it runs only while the help/admin screen is open.

You only write step 3's handler bodies. Everything below is reference detail.

## What the Android developer must create

The preview manifest is sample data. For a real customer app, edit `HelpdeskAndroidAppDetails.kt` first and replace the placeholder screens/actions with the app's real details.

Create or wire these pieces:

- `HelpdeskAndroidAppDetails.kt` - the real list of staff screens, actions, route IDs, and repository handlers.
- Token entry - a staff/admin-only place to paste the `hdk_...` connector key, or secure config that saves it with `HelpdeskEncryptedTokenStore`.
- Staff Help Desk Activity/Fragment - the screen where staff open the bot.
- Navigation map - route IDs such as `inventory.products` mapped to real `navController.navigate(...)`, Activity, Fragment, or deep-link calls.
- Action handlers - approved action names mapped to real repositories/services.
- Lifecycle observer - `HelpdeskConnectorLifecycleObserver` attached only while the staff Help Desk screen is open.

For every staff screen, add:

| Detail | What to enter |
| --- | --- |
| `externalKey` | Stable unique ID, for example `inventory.products`. |
| `module` | App area, for example `Inventory`. |
| `screen` | Screen name staff recognize. |
| `path` | Menu path, for example `Inventory > Products`. |
| `purpose` | What staff do on this screen. |
| `steps` | Click/tap path to complete the task. |
| `fields` | Important fields, whether required, and what they mean. |
| `commonErrors` | Validation messages or common reasons the screen fails. |
| `actions` | Connector action names related to this screen. |
| `navigation.routeId` | Must match a registered navigation target. |

For every action, add:

| Detail | What to enter |
| --- | --- |
| `name` | Approved snake_case action name, for example `search_product`. |
| `type` | `read`, `create`, `update`, `delete`, `report`, or `danger`. |
| `risk` | `low`, `medium`, or `high`. |
| `requiredFields` | Inputs the bot must provide before the handler runs. |
| `handler` | Repository/service method that actually performs the work. |
| `roles` | Staff roles allowed to run it. |
| `confirmation` | Required for write/high-risk actions. |

## Where the connector key goes

1. In Switch&Save, open **Company -> Internal Help Desk -> Create connector**.
2. Choose Android and create the connector.
3. Copy the one-time connector token. It starts with `hdk_`.
4. In the Android app, open `HelpdeskConnectorPreviewActivity`, paste:
   - Base URL: your Switch&Save app URL, for example `https://chatbot.ssepos.co.uk`
   - Connector token: the `hdk_...` token
5. Press **Save key**, then **Preview**, **Audit**, and **Sync**.

The preview screen stores the key with `HelpdeskEncryptedTokenStore`. For production, replace the starter preview connector with your real app wiring:

What works immediately after Save key:

- Preview: local, no network
- Audit: local, no network
- Test route: local navigation callback check
- Sync: background network call to Switch&Save

If Sync fails, the screen now shows the real API/network error. Common causes are wrong Base URL, expired/wrong `hdk_` token, no internet from the Android device/emulator, or server-side validation errors.

```kotlin
HelpdeskConnectorPreviewRegistry.configure {
    HelpdeskQuickStart.setup(
        context = this,
        products = productRepository,
        currentStaffRole = { session.currentStaff.role },
        openScreen = { route -> navController.navigate(route) },
    )
}
```

If you see `Connector is not configured yet`, it means neither the key has been saved in the preview screen nor `HelpdeskConnectorPreviewRegistry.configure { ... }` has been called.

## How staff open Help Desk in the Android app

Add a staff-only menu item such as **Help Desk** or **Support Assistant** in your admin area. That screen should:

1. Build/register the connector.
2. Add `HelpdeskConnectorLifecycleObserver` so sync/events run while the staff screen is open.
3. Render your chat bubble/panel only when `HelpdeskChatController.shouldShow(settings)` returns `true`.
4. Call `helpdeskChat.ask("...")` when staff ask a question.
5. Call `helpdeskChat.openRoute(routeId)` when the bot returns a navigation target.

Do not put the Help Desk token in public/customer screens.

## Files

- `HelpdeskConnectorClient.kt` - HTTP/WebSocket client, polling fallback, action registry, navigation registry, audit, diff, sync, safe result redaction.
- `HelpdeskAndroidAppDetails.kt` - production template where developers add real screens, actions, route IDs, and repositories.
- `HelpdeskEncryptedTokenStore.kt` - encrypted `hdk_...` token storage.
- `HelpdeskAndroidManifestStore.kt` - local saved manifest storage for diff detection.
- `HelpdeskConnectorLifecycleObserver.kt` - opens WebSocket while the helpdesk/admin screen is active and closes it on background.
- `HelpdeskConnectorPreviewActivity.kt` - simple local preview/audit/sync screen.
- The preview activity now uses the default staff Help Desk card design: Chat/History tabs, greeting, quick questions, category chips, large input, settings, and route testing.
- `HelpdeskChatController.kt` - route/role visibility checks and staff-only chat API client.

## Dependencies

Add equivalent dependencies in the customer Android app:

```kotlin
implementation("com.squareup.okhttp3:okhttp:<approved-version>")
implementation("androidx.security:security-crypto:<approved-version>")
implementation("androidx.lifecycle:lifecycle-runtime-ktx:<approved-version>")
```

Use the versions already approved by the Android project if they have them.

## Basic Setup

```kotlin
val tokenStore = HelpdeskEncryptedTokenStore(context)
tokenStore.saveToken("hdk_connector_token_from_dashboard")

val navigation = HelpdeskNavigationRegistry()
    .register(
        HelpdeskNavigationTarget(
            routeId = "inventory.stock_adjustment",
            label = "Open Stock Adjustment",
            route = "inventory/stock-adjustment",
            deepLink = "mypos://inventory/stock-adjustment",
            open = { navController.navigate("inventory/stock-adjustment") }
        )
    )

val actions = HelpdeskActionRegistry(
    roleProvider = HelpdeskRoleProvider { currentStaff.role }
)
    .register(
        HelpdeskConnectorClient.standardActionLibrary().first { it.name == "search_product" },
        HelpdeskActionHandler { input ->
            val results = productRepository.search(input.getString("query"))
            JSONObject().put("results", JSONArray(results.map { product ->
                JSONObject()
                    .put("id", product.id)
                    .put("name", product.name)
                    .put("sku", product.sku)
            }))
        }
    )
    .register(
        HelpdeskConnectorClient.standardActionLibrary().first { it.name == "update_product_price" },
        HelpdeskActionHandler { input ->
            val productId = input.getString("product_id")
            val price = input.getDouble("price")
            productRepository.updatePrice(productId, price)
            JSONObject()
                .put("success", true)
                .put("product_id", productId)
                .put("price", price)
        }
    )

val connector = HelpdeskConnectorClient(
    baseUrl = "https://your-platform-domain.com",
    socketBaseUrl = "https://your-websocket-gateway-domain.com", // optional; omit when proxied through baseUrl
    tokenProvider = tokenStore,
    actionRegistry = actions,
    navigationRegistry = navigation,
    manifestStore = HelpdeskAndroidManifestStore(context)
)
```

## Lifecycle

Use WebSocket only while the staff/admin helpdesk area is active:

```kotlin
lifecycle.addObserver(
    HelpdeskConnectorLifecycleObserver(
        connector = connector,
        appVersion = BuildConfig.VERSION_NAME
    )
)
```

If WebSocket fails, the client reports the failure and starts safe polling fallback with backoff. Polling checks only Switch&Save queued events; it does not scan the customer database.

## Embedded Staff Chat

Use `HelpdeskChatController` inside authenticated staff screens. The Android app decides where the chat appears:

```kotlin
val helpdeskChat = HelpdeskChatController(
    baseUrl = "https://your-platform-domain.com",
    tokenProvider = tokenStore,
    staffRoleProvider = { currentStaff.role },
    currentRouteProvider = { navController.currentDestination?.route ?: "dashboard" },
    navigationRegistry = navigation
)

if (helpdeskChat.shouldShow(settings)) {
    // Render your chat bubble or panel.
}
```

When the API returns a `navigationTargets` item, call:

```kotlin
helpdeskChat.openRoute("purchase_orders.create")
```

Also read:

- `ANDROID_UI_GUIDE.md`
- `../docs/UI_COMPONENT_GUIDE.md`
- `../docs/CONNECTOR_TEST_PLAN.md`

## Preview And Audit Screen

For a first smoke test, open the preview activity directly, paste the Base URL and `hdk_...` token, then press **Save key**. That creates a starter preview connector so Preview/Audit/Sync are not blocked by `connectorProvider is not configured`.

For production, register the real connector provider before opening the preview activity:

```kotlin
HelpdeskConnectorPreviewRegistry.configure { connector }
startActivity(Intent(context, HelpdeskConnectorPreviewActivity::class.java))
```

The screen shows the human-readable manifest, audit blockers/warnings, and a sync button. Sync is blocked if audit finds missing handlers, unsafe write actions, duplicate keys, obvious secrets, or dangerous actions enabled by default.

Use **Test route** before Sync. Enter a `routeId` such as `inventory.products`; if it fails, add that route in `HelpdeskAndroidAppDetails.kt -> buildNavigation(...)` and map it to the real Android navigation callback.

## Production Rules

- Store the connector token with `HelpdeskEncryptedTokenStore`.
- Never log the token.
- Register action handlers against existing repositories/services, not SQL generated by an LLM.
- Validate role before write actions.
- Require `confirmed = true` before create/update/danger handlers run.
- Return only fields needed for the bot answer.
- Keep large results out of responses; the client redacts and truncates defensively.
