# Android Help Desk UI Guide

Use `HelpdeskChatController.kt` for route/role checks and API calls.

## Default Design

Use the default card layout from `HelpdeskConnectorPreviewActivity.kt` as the baseline for the staff Help Desk screen:

- Chat/History tabs
- centered bot icon and greeting
- quick questions for products, stock, price, purchase orders, and reports
- category chips
- large rounded input
- settings/setup panel
- route tester

The preview screen is no longer only a debug screen. It is the reference design for the production Activity/Fragment.

## Jetpack Compose Shape

```kotlin
@Composable
fun HelpdeskChatHost(
    controller: HelpdeskChatController,
    settings: HelpdeskChatSettings
) {
    if (!controller.shouldShow(settings)) return

    var open by remember { mutableStateOf(false) }

    if (open) {
        HelpdeskChatPanel(controller = controller, onClose = { open = false })
    } else {
        FloatingActionButton(onClick = { open = true }) {
            Text("?")
        }
    }
}
```

## Navigation

Register route IDs:

```kotlin
navigation.register(
    HelpdeskNavigationTarget(
        routeId = "purchase_orders.create",
        label = "Open Create Purchase Order",
        route = "purchase/orders/new",
        open = { navController.navigate("purchase/orders/new") }
    )
)
```

When API returns a navigation target:

```kotlin
controller.openRoute(routeId)
```

Verify routes before Sync:

```kotlin
val ok = connector.openNavigationTarget("inventory.products")
```

If it returns `false`, add that route in `HelpdeskAndroidAppDetails.kt -> buildNavigation(...)` and map it to `navController.navigate(...)`, an Activity, Fragment, or deep link.

## XML/Activity

Use a `FrameLayout` overlay or a dedicated panel. Show/hide it from:

```kotlin
if (controller.shouldShow(settings)) {
    helpdeskContainer.visibility = View.VISIBLE
} else {
    helpdeskContainer.visibility = View.GONE
}
```

## Safety

- Do not show on login, payment, checkout, or customer-display screens.
- Store token with `HelpdeskEncryptedTokenStore`.
- Require confirmation for write actions.
