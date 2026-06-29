# .NET WinForms/WPF Help Desk UI Guide

Use `HelpdeskChatController.cs` for the logic. The UI can be WinForms, WPF, MAUI, or Avalonia.

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

## Safety

- Hide chat on login/payment/customer-display screens.
- Validate local role before write actions.
- Show confirmation before updates.
