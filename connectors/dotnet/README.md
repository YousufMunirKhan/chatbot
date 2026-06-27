# .NET Help Desk Connector Starter

Use this for Windows POS, ERP, inventory, or local .NET software.

## Run

```powershell
$env:HELPDESK_BASE_URL="http://localhost:3000"
$env:HELPDESK_CONNECTOR_TOKEN="hdk_your_token"
dotnet run --project .\connectors\dotnet\SwitchSave.HelpdeskConnector.csproj
```

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

Replace the in-memory `PosActionHandlers` in `Program.cs` with your real POS service calls.

Keep this rule:

```text
LLM chooses approved event -> connector validates -> POS executes locally
```

Do not let the LLM write SQL directly.
