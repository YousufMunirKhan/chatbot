# .NET Help Desk Connector Starter

Use this for Windows POS, ERP, inventory, or local .NET software.

## Give This Zip To A Developer Or AI

After unzipping, start with:

1. `AI_IMPLEMENTATION_BRIEF.md` - the short instruction file to paste into Cursor, Claude Code, Codex, or give to a developer.
2. `HelpdeskDotnetAppDetails.cs` - the file to edit with the customer's real forms/screens, route commands, actions, and service methods.
3. `Program.cs` - starter runner that previews, audits, syncs, then opens WebSocket or polling fallback.
4. `HelpdeskDefaultChatViewModel.cs` - default chat/settings model with quick questions, categories, ask, and route testing.
5. `HelpdeskChatController.cs` and `WINFORMS_WPF_UI.md` - staff-only embedded chat UI.

The starter data is only sample data. Production is ready only after `HelpdeskDotnetAppDetails.cs` matches the real app.

## Run

```powershell
$env:HELPDESK_BASE_URL="https://chatbot.ssepos.co.uk"
$env:HELPDESK_CONNECTOR_TOKEN="hdk_your_token_from_help_desk"
dotnet run --project .\connectors\dotnet\SwitchSave.HelpdeskConnector.csproj
```

## Where the connector key goes

1. In Switch&Save, open **Company -> Internal Help Desk -> Create connector**.
2. Choose .NET and create the connector.
3. Copy the one-time token. It starts with `hdk_`.
4. Set it as `HELPDESK_CONNECTOR_TOKEN` on the POS machine or Windows service.
5. Set `HELPDESK_BASE_URL` to your Switch&Save app URL, for example `https://chatbot.ssepos.co.uk`.
6. Start the connector. It prints Preview/Audit output, syncs the manifest, then opens WebSocket or polling fallback.

Do not store the token in source control. Use Windows service environment variables, a protected appsettings secret, or the customer's existing secure configuration store.

## What It Does

On startup it:

1. Checks connector status.
2. Syncs two POS help-doc drafts:
   - Inventory > Products > Add Product
   - Reports > Sales > End Of Day
3. Registers POS actions:
   - `search_product`
   - `check_stock`
   - `low_stock_products`
   - `daily_sales_report`
   - `end_of_day_report`
   - `update_product_quantity`
4. Polls for queued events every 5 seconds.

It also reads `manifestRevision` and `syncRequired` from status/events. When the dashboard requests a resync, the connector sends the latest docs/actions again automatically.

## Connect It To Your POS

First edit `HelpdeskDotnetAppDetails.cs`:

- add real forms/screens/modules
- add real menu paths, steps, fields, and common errors
- map route IDs to WinForms/WPF commands, form openers, shell routes, or deep links
- keep only actions the POS can safely support

Then replace the in-memory `PosActionHandlers` in `Program.cs` with your real POS service calls.

For every screen/form, add:

| Detail | What to enter |
| --- | --- |
| `externalKey` | Stable unique ID, for example `inventory.products`. |
| `module` | POS area, for example `Inventory`. |
| `screen` | Form/screen name staff recognize. |
| `path` | Menu path, for example `Inventory > Products`. |
| `purpose` | What staff do on this screen. |
| `steps` | Click path to complete the task. |
| `fields` | Important fields, required status, and meaning. |
| `commonErrors` | Validation messages or common failure reasons. |
| `actions` | Connector action names related to this screen. |
| `navigation.routeId` | Must match a local route/command mapping. |

For every action, add:

| Detail | What to enter |
| --- | --- |
| `name` | Approved snake_case action name, for example `search_product`. |
| `type` | `read`, `create`, `update`, `delete`, `report`, or `danger`. |
| `risk` | `low`, `medium`, or `high`. |
| `requiredFields` | Inputs the bot must provide before the handler runs. |
| `handler` | Real POS/ERP service method. |
| `roles` | Staff roles allowed to run it. |
| `confirmation` | Required for write/high-risk actions. |

Keep this rule:

```text
LLM chooses approved event -> connector validates -> POS executes locally
```

Do not let the LLM write SQL directly.

## Embedded Staff Chat

Also read:

- `HelpdeskChatController.cs`
- `WINFORMS_WPF_UI.md`
- `../docs/UI_COMPONENT_GUIDE.md`

Your app decides where the Help Desk chat appears using role + current form/screen. Hide it on login, payment, checkout, and customer-display screens.

Add a staff-only **Help Desk** button/menu item in WinForms/WPF. That screen should:

1. Create an `HttpClient` with `BaseAddress = HELPDESK_BASE_URL`.
2. Add `Authorization: Bearer HELPDESK_CONNECTOR_TOKEN`.
3. Create `HelpdeskChatController`.
4. Show the chat panel only when `ShouldShow(HelpdeskChatSettings.Default)` returns true.
5. Call `AskAsync(text)` for staff questions.
6. Call `OpenRoute(routeId)` when the bot returns a navigation target.
7. Bind `HelpdeskDefaultChatViewModel` to the default card design: Chat/History tabs, greeting, quick questions, category chips, large input, and Settings route tester.

Verify routes before Sync:

```csharp
var result = viewModel.TestRoute("inventory.products");
Console.WriteLine(result.Message);
```
