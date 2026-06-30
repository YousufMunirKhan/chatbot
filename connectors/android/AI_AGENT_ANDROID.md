# Android AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating an Android POS or mobile business app.

## First File To Edit

Start with `HelpdeskAndroidAppDetails.kt`. Replace the sample screens, actions, route IDs, repositories, and staff role checks with the real Android app details. The preview activity is only a smoke-test surface until this file matches the customer app.

Before editing, read `../docs/AUTO_DISCOVERY_PLAYBOOK.md`. The starter manifest is not enough for a real POS. If Preview only shows Dashboard, Products, Reports, Orders, Customers, Purchase, and Settings examples, the app menu has not been fully discovered yet.

## Auto Discovery Pass

Ask the AI agent to inspect the Android project and build a complete screen map from:

- `nav_graph.xml`, Compose `NavHost`, route constants, Activity declarations, Fragment classes.
- Drawer, bottom navigation, toolbar menu, dashboard tile, and settings menu definitions.
- Screen title strings, button labels, validation strings, and empty-state messages.
- ViewModels/repositories for products, stock, orders, customers, purchases, reports, printer, terminal, sync, tax, branch, and staff settings.

Generate one `screenDoc(...)` per staff screen. Add matching `HelpdeskNavigationTarget` entries and test each `routeId` in `HelpdeskConnectorPreviewActivity` before Sync.

## What To Inspect

Ask the developer to provide:

- Navigation graph, Compose navigation routes, or Activity/Fragment list.
- Menu drawer/bottom tab definitions.
- Screen titles and button labels.
- ViewModels, repositories, and services for product, stock, customer, invoice, order, and report flows.
- Validation strings and error messages.
- Role/permission checks.
- Existing deep links, if any.

## Android Navigation

For clickable paths, map every supported screen to one stable `routeId`.

Examples:

```kotlin
data class HelpdeskNavigationTarget(
    val routeId: String,
    val label: String,
    val route: String? = null,
    val deepLink: String? = null
)
```

```kotlin
val helpdeskNavigationTargets = listOf(
    HelpdeskNavigationTarget(
        routeId = "inventory.add_product",
        label = "Open Add Product",
        route = "inventory/products/new",
        deepLink = "mypos://inventory/products/new"
    )
)
```

If the connector runs inside the app, call the app router:

```kotlin
navController.navigate("inventory/products/new")
```

If opened from outside, use a deep link:

```kotlin
val intent = Intent(Intent.ACTION_VIEW, Uri.parse("mypos://inventory/products/new"))
context.startActivity(intent)
```

## Android Action Handlers

Register handlers that call existing app services. Do not query SQLite directly from LLM output.

```kotlin
val handlers = mapOf(
    "search_product" to { input: JSONObject ->
        val query = input.optString("query")
        val results = productRepository.search(query)
        JSONObject().put("results", JSONArray(results.map { product ->
            JSONObject()
                .put("id", product.id)
                .put("name", product.name)
                .put("sku", product.sku)
        }))
    },
    "update_product_quantity" to { input: JSONObject ->
        requireCurrentUserRole("admin", "manager")
        val productId = input.getString("product_id")
        val quantity = input.getInt("quantity")
        inventoryRepository.updateQuantity(productId, quantity)
        JSONObject()
            .put("success", true)
            .put("product_id", productId)
            .put("quantity", quantity)
    }
)
```

## Android Security

- Store `hdk_...` token in encrypted storage or backend config.
- Do not put the connector token in logs.
- Validate local staff role before write handlers.
- Return minimal result fields.
- Prefer WorkManager/foreground service only when the app architecture permits polling.

## Android Deliverables

Generate:

1. Manifest builder for screens/actions.
2. Navigation target registry.
3. Action handler registry.
4. Preview/audit screen or debug activity.
5. Sync worker using `HelpdeskConnectorClient.kt`.

## Required Runtime Wiring

- Use `HelpdeskEncryptedTokenStore` for the `hdk_...` connector token.
- Use `HelpdeskActionRegistry` and register handlers against existing repositories/services.
- Use `HelpdeskNavigationRegistry` and register each route/deep link with an actual app navigation callback.
- Use `HelpdeskConnectorLifecycleObserver` on the helpdesk/admin screen so WebSocket connects only while active and closes on background.
- Use `HelpdeskConnectorPreviewActivity` or an equivalent app-native screen for preview, audit, and sync before enabling the connector.
- Run `connector.auditManifest()` before sync and fix all blockers.
- For write actions, pass `confirmed = true` only after the staff user confirms the exact change.
- Do Android Studio build/testing inside the target Android app because this starter is source-only and depends on the app's repositories, navigation, lifecycle, and dependency versions.
