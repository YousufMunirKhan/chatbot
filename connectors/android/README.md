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

## Files

- `HelpdeskConnectorClient.kt` - HTTP/WebSocket client, polling fallback, action registry, navigation registry, audit, diff, sync, safe result redaction.
- `HelpdeskEncryptedTokenStore.kt` - encrypted `hdk_...` token storage.
- `HelpdeskAndroidManifestStore.kt` - local saved manifest storage for diff detection.
- `HelpdeskConnectorLifecycleObserver.kt` - opens WebSocket while the helpdesk/admin screen is active and closes it on background.
- `HelpdeskConnectorPreviewActivity.kt` - simple local preview/audit/sync screen.
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

Register the connector provider before opening the preview activity:

```kotlin
HelpdeskConnectorPreviewRegistry.connectorProvider = { connector }
startActivity(Intent(context, HelpdeskConnectorPreviewActivity::class.java))
```

The screen shows the human-readable manifest, audit blockers/warnings, and a sync button. Sync is blocked if audit finds missing handlers, unsafe write actions, duplicate keys, obvious secrets, or dangerous actions enabled by default.

## Production Rules

- Store the connector token with `HelpdeskEncryptedTokenStore`.
- Never log the token.
- Register action handlers against existing repositories/services, not SQL generated by an LLM.
- Validate role before write actions.
- Require `confirmed = true` before create/update/danger handlers run.
- Return only fields needed for the bot answer.
- Keep large results out of responses; the client redacts and truncates defensively.
