# .NET AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating Windows POS, ERP, inventory, or local .NET software.

Set `HELPDESK_BASE_URL` for HTTP APIs. If the WebSocket gateway is hosted separately, also set `HELPDESK_WS_BASE_URL`; otherwise the connector uses `HELPDESK_BASE_URL` for both.

## First File To Edit

Start with `HelpdeskDotnetAppDetails.cs`. Replace the sample forms/screens, route commands, actions, and service interfaces with the real Windows POS/ERP/admin app details. `Program.cs` uses this file for preview/audit/sync.

## What To Inspect

Ask the developer to provide:

- WinForms forms, WPF windows/pages, MAUI pages, Avalonia views, or console command menus.
- Main menu/ribbon/sidebar definitions.
- ViewModels, services, repositories, and validation rules.
- Existing commands for opening screens.
- Product, stock, customer, invoice, order, and report service methods.
- Staff role/permission model.

## .NET Navigation

For clickable paths, map every supported screen to a command or custom URI:

```csharp
public sealed record HelpdeskNavigationTarget(
    string RouteId,
    string Label,
    string? Command,
    string? Uri
);
```

```csharp
var navigationTargets = new[]
{
    new HelpdeskNavigationTarget(
        RouteId: "inventory.add_product",
        Label: "Open Add Product",
        Command: "OpenAddProductScreen",
        Uri: "mypos://inventory/products/new"
    )
};
```

If the connector runs inside the desktop app, map the command to UI navigation:

```csharp
navigation.Register("inventory.add_product", () =>
{
    mainWindow.OpenAddProductScreen();
});
```

If the connector runs as an external worker/service, use a custom URI protocol, named pipe, localhost endpoint, or disable direct navigation for screens that cannot be opened safely.

## Embedded Staff Chat

Use `HelpdeskChatController.cs` in authenticated staff windows/panels. The host app controls visibility:

```csharp
if (helpdeskChat.ShouldShow(settings))
{
    helpdeskPanel.Visible = true;
}
```

When the API returns a navigation target, call the local route/command registry. The platform never directly opens local screens.

## .NET Action Handlers

Register handlers that call existing services:

```csharp
connector.RegisterAction("search_product", async input =>
{
    var query = input.GetString("query");
    var results = await productService.SearchAsync(query);
    return new {
        results = results.Select(p => new {
            id = p.Id,
            name = p.Name,
            sku = p.Sku
        })
    };
});

connector.RegisterAction("update_product_quantity", async input =>
{
    currentUser.RequireRole("admin", "manager");
    var productId = input.GetString("product_id");
    var quantity = input.GetInt("quantity");
    var reason = input.GetString("reason");
    await inventoryService.UpdateQuantityAsync(productId, quantity, reason);
    return new { success = true, product_id = productId, quantity };
});
```

## .NET Security

- Store the connector token in Windows credential storage, encrypted app settings, or secure deployment config.
- Do not log `hdk_...` tokens.
- Validate local staff role before write handlers.
- Never let LLM-generated code execute arbitrary SQL.
- Return minimal result fields.
- Avoid UI automation as the first option; prefer app commands/services.

## .NET Deliverables

Generate:

1. Manifest builder for forms/pages/menus/actions.
2. Local Connector Studio UI or console preview/editor.
3. Audit command.
4. Action handler registry.
5. Navigation command registry.
6. Background poll/sync loop using the existing .NET starter.
