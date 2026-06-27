# Android Help Desk Connector Starter

Use this inside an Android POS or mobile business app.

## Files

- `HelpdeskConnectorClient.kt` - small HTTP client for status, sync, polling, and event results.

It uses Android's built-in `HttpURLConnection` and `org.json`, so no required dependency is added.

## Example Usage

```kotlin
val connector = HelpdeskConnectorClient(
    baseUrl = "https://your-platform-domain.com",
    token = "hdk_your_token",
    handlers = mapOf(
        "search_product" to { input ->
            val query = input.optString("query")
            JSONObject().put("results", JSONArray().put(JSONObject().put("name", "Pepsi 500ml").put("query", query)))
        },
        "daily_sales_report" to { input ->
            JSONObject()
                .put("date", input.optString("date"))
                .put("orders", 42)
                .put("gross_sales", 68000)
                .put("currency", "PKR")
        },
        "update_product_quantity" to { input ->
            JSONObject()
                .put("product_id", input.optString("product_id"))
                .put("next_quantity", input.optInt("quantity"))
                .put("updated", true)
        }
    )
)

connector.checkStatus()
connector.syncPosManifest()
connector.pollOnce()
```

For production workers, call one cycle:

```kotlin
connector.runCycle()
```

`runCycle()` checks the server manifest revision. If the dashboard requested a resync, the connector sends the latest docs/actions before polling events.

## Integration Notes

Run `pollOnce()` from a foreground service, worker, or app-controlled background job depending on your app's architecture and Android version.

For production:

- Store the connector token in encrypted storage.
- Validate user role before write events.
- Keep dangerous events disabled.
- Return only the data needed for the bot answer.
