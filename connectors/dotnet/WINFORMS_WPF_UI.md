# .NET WinForms/WPF Help Desk UI Guide

Use `HelpdeskChatController.cs` for the logic. The UI can be WinForms, WPF, MAUI, or Avalonia.

## Default Design

Use `HelpdeskDefaultChatViewModel.cs` as the default staff Help Desk model. Bind it to a card/panel with:

- Chat/History tabs
- centered bot icon and greeting
- quick questions for products, stock, price, purchase orders, and reports
- category chips
- large rounded input
- settings/setup panel
- route tester

The design should match the web/Android card layout, not a raw log/debug window.

## WinForms

```csharp
if (helpdeskChat.ShouldShow(settings))
{
    helpdeskPanel.Visible = true;
}
else
{
    helpdeskPanel.Visible = false;
}
```

For navigation:

```csharp
var routes = new Dictionary<string, Action>
{
    ["purchase_orders.create"] = () => mainForm.OpenPurchaseOrderForm(),
};

bool OpenRoute(string routeId)
{
    if (!routes.TryGetValue(routeId, out var open)) return false;
    open();
    return true;
}
```

## WPF

Create a `UserControl` with:

- message list
- quick pill buttons
- navigation buttons
- guided action form
- input box

Bind it to a view model that calls `HelpdeskChatController.AskAsync(...)`.

Route verification:

```csharp
var result = viewModel.TestRoute("inventory.products");
statusLabel.Text = result.Message;
```

If `result.Ok` is false, add the route in `HelpdeskDotnetAppDetails.cs` and map it to a form/window command.

## Safety

- Hide chat on login/payment/customer-display screens.
- Validate local role before write actions.
- Show confirmation before updates.
