package com.switchsave.helpdesk

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class HelpdeskConnectorClient(
    private val baseUrl: String,
    private val token: String,
    private val handlers: Map<String, (JSONObject) -> JSONObject>
) {
    private var knownRevision: Int = 0

    fun checkStatus(): JSONObject {
        return request("GET", "/api/helpdesk/connectors/status")
    }

    fun syncPosManifest(appVersion: String = "android-pos-starter-0.1"): JSONObject {
        val payload = JSONObject()
            .put("appVersion", appVersion)
            .put("clientRevision", knownRevision)
            .put(
                "documents",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("externalKey", "inventory.stock-adjustment")
                            .put("module", "Inventory")
                            .put("screen", "Stock Adjustment")
                            .put("path", "Inventory > Stock Adjustment")
                            .put("purpose", "Update product stock quantity from the Android POS app.")
                            .put(
                                "steps",
                                JSONArray()
                                    .put("Open Inventory.")
                                    .put("Tap Stock Adjustment.")
                                    .put("Search or scan the product.")
                                    .put("Enter the new quantity.")
                                    .put("Tap Save.")
                            )
                            .put(
                                "fields",
                                JSONArray()
                                    .put(
                                        JSONObject()
                                            .put("name", "Product")
                                            .put("required", true)
                                            .put("description", "Product selected by search or barcode.")
                                    )
                                    .put(
                                        JSONObject()
                                            .put("name", "Quantity")
                                            .put("required", true)
                                            .put("description", "New stock quantity.")
                                    )
                            )
                            .put(
                                "commonErrors",
                                JSONArray()
                                    .put("Quantity cannot be negative.")
                                    .put("Only manager or admin can update stock.")
                            )
                            .put("actions", JSONArray().put("search_product").put("update_product_quantity"))
                    )
                    .put(
                        JSONObject()
                            .put("externalKey", "reports.daily-sales")
                            .put("module", "Reports")
                            .put("screen", "Daily Sales")
                            .put("path", "Reports > Daily Sales")
                            .put("purpose", "Show daily sales summary from the Android POS app.")
                            .put(
                                "steps",
                                JSONArray()
                                    .put("Open Reports.")
                                    .put("Tap Daily Sales.")
                                    .put("Choose the date.")
                                    .put("Tap Generate.")
                            )
                            .put(
                                "fields",
                                JSONArray()
                                    .put(JSONObject().put("name", "Date").put("required", true))
                                    .put(JSONObject().put("name", "Branch").put("required", false))
                            )
                            .put("commonErrors", JSONArray().put("No sales appear if the date has no completed orders."))
                            .put("actions", JSONArray().put("daily_sales_report").put("end_of_day_report"))
                    )
            )
            .put(
                "actions",
                JSONArray()
                    .put(action("search_product", "Search products by name or barcode.", "read", "low", listOf("query")))
                    .put(action("check_stock", "Return stock quantity for a product.", "read", "low", listOf("product_id")))
                    .put(action("low_stock_products", "List low-stock products.", "report", "low", emptyList(), listOf("threshold")))
                    .put(action("daily_sales_report", "Return sales summary for a date.", "report", "low", listOf("date"), listOf("branch_id")))
                    .put(action("end_of_day_report", "Return end-of-day close summary.", "report", "low", listOf("date"), listOf("branch_id")))
                    .put(action("update_product_quantity", "Update stock quantity for one product.", "update", "medium", listOf("product_id", "quantity"), listOf("reason"), true))
            )

        val response = request("POST", "/api/helpdesk/connectors/sync", payload)
        knownRevision = response.optInt("manifestRevision", knownRevision)
        return response
    }

    fun runCycle(): Int {
        val status = checkStatus()
        handleSyncCommand(status)
        return pollOnce()
    }

    fun pollOnce(): Int {
        val response = request("GET", "/api/helpdesk/connectors/events")
        handleSyncCommand(response)
        val events = response.optJSONArray("events") ?: JSONArray()
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index)
            val eventId = event.getString("id")
            val name = event.getString("name")
            val input = event.optJSONObject("input") ?: JSONObject()
            try {
                val handler = handlers[name] ?: error("Unsupported event: $name")
                sendEventResult(eventId, "completed", handler(input), null)
            } catch (error: Throwable) {
                sendEventResult(eventId, "failed", null, error.message ?: "Event failed")
            }
        }
        return events.length()
    }

    private fun handleSyncCommand(response: JSONObject) {
        val serverRevision = response.optInt("manifestRevision", knownRevision)
        if (response.optBoolean("syncRequired", false) || serverRevision > knownRevision) {
            syncPosManifest()
            knownRevision = serverRevision
        }
    }

    private fun sendEventResult(eventId: String, status: String, response: JSONObject?, error: String?) {
        request(
            "POST",
            "/api/helpdesk/connectors/events",
            JSONObject()
                .put("eventId", eventId)
                .put("status", status)
                .put("response", response)
                .put("error", error)
        )
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Content-Type", "application/json")
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000

        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }

        val stream = if (connection.responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val text = BufferedReader(InputStreamReader(stream)).use { it.readText() }
        if (connection.responseCode !in 200..299) {
            error("Connector API error ${connection.responseCode}: $text")
        }
        return JSONObject(text)
    }

    private fun action(
        name: String,
        description: String,
        type: String,
        risk: String,
        requiredFields: List<String>,
        optionalFields: List<String> = emptyList(),
        needsConfirmation: Boolean = false
    ): JSONObject {
        return JSONObject()
            .put("name", name)
            .put("description", description)
            .put("type", type)
            .put("risk", risk)
            .put("requiredFields", JSONArray(requiredFields))
            .put("optionalFields", JSONArray(optionalFields))
            .put("allowedRoles", JSONArray(listOf("admin", "manager", "cashier")))
            .put("needsConfirmation", needsConfirmation)
    }
}
