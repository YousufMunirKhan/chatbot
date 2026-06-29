# Android Help Desk UI Guide

Use `HelpdeskChatController.kt` for route/role checks and API calls.

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
