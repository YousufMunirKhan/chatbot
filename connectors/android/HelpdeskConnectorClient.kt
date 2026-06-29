package com.switchsave.helpdesk

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.min

fun interface HelpdeskTokenProvider {
    fun getToken(): String
}

fun interface HelpdeskRoleProvider {
    fun currentRole(): String?
}

fun interface HelpdeskActionHandler {
    fun run(input: JSONObject): JSONObject
}

data class HelpdeskActionDefinition(
    val name: String,
    val description: String,
    val type: String,
    val risk: String,
    val requiredFields: List<String> = emptyList(),
    val optionalFields: List<String> = emptyList(),
    val allowedRoles: List<String> = listOf("admin", "manager"),
    val needsConfirmation: Boolean = false,
    val enabled: Boolean = true
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("name", name)
            .put("description", description)
            .put("type", type)
            .put("risk", risk)
            .put("requiredFields", JSONArray(requiredFields))
            .put("optionalFields", JSONArray(optionalFields))
            .put("allowedRoles", JSONArray(allowedRoles))
            .put("needsConfirmation", needsConfirmation)
            .put("enabled", enabled)
    }
}

data class HelpdeskNavigationTarget(
    val routeId: String,
    val label: String,
    val route: String? = null,
    val deepLink: String? = null,
    val open: (() -> Unit)? = null
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("label", label)
            .put("routeId", routeId)
            .put(
                "platformTargets",
                JSONObject().put(
                    "android",
                    JSONObject()
                        .put("route", route)
                        .put("deepLink", deepLink)
                )
            )
    }
}

class HelpdeskNavigationRegistry {
    private val targets = linkedMapOf<String, HelpdeskNavigationTarget>()

    fun register(target: HelpdeskNavigationTarget): HelpdeskNavigationRegistry {
        require(target.routeId.isNotBlank()) { "Navigation routeId is required." }
        targets[target.routeId] = target
        return this
    }

    fun open(routeId: String): Boolean {
        val target = targets[routeId] ?: return false
        val opener = target.open ?: return false
        opener()
        return true
    }

    fun has(routeId: String): Boolean = targets.containsKey(routeId)

    fun all(): List<HelpdeskNavigationTarget> = targets.values.toList()
}

class HelpdeskActionRegistry(
    private val roleProvider: HelpdeskRoleProvider = HelpdeskRoleProvider { null },
    private val handlerTimeoutMs: Long = 20_000
) {
    private data class Entry(
        val definition: HelpdeskActionDefinition,
        val handler: HelpdeskActionHandler
    )

    private val entries = linkedMapOf<String, Entry>()

    fun register(
        definition: HelpdeskActionDefinition,
        handler: HelpdeskActionHandler
    ): HelpdeskActionRegistry {
        require(definition.name.matches(Regex("^[a-z][a-z0-9_]*$"))) {
            "Action names must be snake_case: ${definition.name}"
        }
        entries[definition.name] = Entry(definition, handler)
        return this
    }

    fun has(name: String): Boolean = entries.containsKey(name)

    fun definitions(): List<HelpdeskActionDefinition> = entries.values.map { it.definition }

    fun run(name: String, input: JSONObject): JSONObject {
        val entry = entries[name] ?: error("Unsupported action: $name")
        val definition = entry.definition
        require(definition.enabled) { "Action is disabled: $name" }
        validateRequiredFields(definition, input)
        validateRole(definition)
        validateConfirmation(definition, input)

        val executor = Executors.newSingleThreadExecutor()
        return try {
            val future = executor.submit<JSONObject> { entry.handler.run(input) }
            future.get(handlerTimeoutMs, TimeUnit.MILLISECONDS)
        } finally {
            executor.shutdownNow()
        }
    }

    private fun validateRequiredFields(definition: HelpdeskActionDefinition, input: JSONObject) {
        val missing = definition.requiredFields.filter { !input.has(it) || input.isNull(it) }
        require(missing.isEmpty()) {
            "Missing required field(s) for ${definition.name}: ${missing.joinToString(", ")}"
        }
    }

    private fun validateRole(definition: HelpdeskActionDefinition) {
        if (definition.allowedRoles.isEmpty()) return
        val role = roleProvider.currentRole()?.lowercase(Locale.US)
        val allowed = definition.allowedRoles.map { it.lowercase(Locale.US) }
        require(role != null && allowed.contains(role)) {
            "Current staff role is not allowed to run ${definition.name}."
        }
    }

    private fun validateConfirmation(definition: HelpdeskActionDefinition, input: JSONObject) {
        val writeLike = definition.type in setOf("create", "update", "danger")
        if (writeLike || definition.needsConfirmation || definition.risk == "high") {
            require(input.optBoolean("confirmed", false)) {
                "Action ${definition.name} needs explicit confirmation before execution."
            }
        }
    }
}

interface HelpdeskManifestStore {
    fun loadManifest(): JSONObject?
    fun saveManifest(manifest: JSONObject)
}

class HelpdeskConnectorClient(
    private val baseUrl: String,
    private val socketBaseUrl: String? = null,
    private val tokenProvider: HelpdeskTokenProvider,
    private val actionRegistry: HelpdeskActionRegistry,
    private val navigationRegistry: HelpdeskNavigationRegistry = HelpdeskNavigationRegistry(),
    private val manifestStore: HelpdeskManifestStore? = null,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build(),
    private val pollIntervalSeconds: Int = 60,
    private val maxResultBytes: Int = 24_000
) {
    constructor(
        baseUrl: String,
        token: String,
        handlers: Map<String, (JSONObject) -> JSONObject>,
        deliveryMode: String = "polling_fallback",
        pollIntervalSeconds: Int = 60
    ) : this(
        baseUrl = baseUrl,
        socketBaseUrl = null,
        tokenProvider = HelpdeskTokenProvider { token },
        actionRegistry = registryFromHandlers(handlers),
        pollIntervalSeconds = pollIntervalSeconds
    )

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var pollingTask: ScheduledFuture<*>? = null
    private var reconnectTask: ScheduledFuture<*>? = null
    private var webSocket: WebSocket? = null
    private var activeSession = false
    private var knownRevision: Int = 0
    private var activeDeliveryMode: String = "polling_fallback"
    private var idlePollSeconds: Int = pollIntervalSeconds
    private var reconnectDelaySeconds: Int = 2

    fun checkStatus(): JSONObject {
        return request("GET", "/api/helpdesk/connectors/status")
    }

    fun syncPosManifest(appVersion: String = "android-pos-starter-1.0"): JSONObject {
        val manifest = buildDefaultManifest(appVersion)
        return syncManifest(manifest)
    }

    fun syncManifest(manifest: JSONObject): JSONObject {
        val audit = auditManifest(manifest)
        require(audit.getJSONArray("blocked").length() == 0) {
            "Connector audit blocked sync: ${audit.getJSONArray("blocked")}"
        }

        val payload = JSONObject(manifest.toString())
            .put("audit", audit)
            .put("diff", diffManifest(manifestStore?.loadManifest(), manifest))

        val response = request("POST", "/api/helpdesk/connectors/sync", payload)
        knownRevision = response.optInt("manifestRevision", knownRevision)
        manifestStore?.saveManifest(manifest)
        return response
    }

    fun runCycle(): Int {
        val status = checkStatus()
        handleSyncCommand(status)
        return pollOnce()
    }

    fun startActiveSession(appVersion: String = "android-pos-starter-1.0") {
        activeSession = true
        connectWebSocket(appVersion)
    }

    fun stopActiveSession() {
        activeSession = false
        pollingTask?.cancel(false)
        pollingTask = null
        reconnectTask?.cancel(false)
        reconnectTask = null
        webSocket?.close(1000, "Android helpdesk session stopped")
        webSocket = null
        reportHealth("websocket_disconnected", "info", "Android active helpdesk session stopped.")
    }

    fun onHelpdeskScreenStarted(appVersion: String = "android-pos-starter-1.0") {
        startActiveSession(appVersion)
    }

    fun onHelpdeskScreenStopped() {
        stopActiveSession()
    }

    fun pollOnce(): Int {
        val started = System.currentTimeMillis()
        reportHealth("poll_attempt", "info", pollIntervalSeconds = idlePollSeconds)
        return try {
            val response = request("GET", "/api/helpdesk/connectors/events")
            handleSyncCommand(response)
            val events = response.optJSONArray("events") ?: JSONArray()
            for (index in 0 until events.length()) {
                handleEvent(events.getJSONObject(index), "polling_fallback")
            }
            reportHealth(
                "poll_success",
                "success",
                durationMs = (System.currentTimeMillis() - started).toInt(),
                eventsReturned = events.length(),
                pollIntervalSeconds = idlePollSeconds
            )
            events.length()
        } catch (error: Throwable) {
            reportHealth(
                "poll_failed",
                "error",
                error.message ?: "Polling failed.",
                durationMs = (System.currentTimeMillis() - started).toInt(),
                pollIntervalSeconds = idlePollSeconds
            )
            0
        }
    }

    fun openNavigationTarget(routeId: String): Boolean {
        return navigationRegistry.open(routeId)
    }

    fun previewManifest(manifest: JSONObject = buildDefaultManifest()): String {
        val lines = mutableListOf<String>()
        lines += "Help Desk Connector Preview"
        lines += ""
        lines += "Screens"
        val docs = manifest.optJSONArray("documents") ?: JSONArray()
        for (index in 0 until docs.length()) {
            val doc = docs.getJSONObject(index)
            lines += "- ${doc.optString("module")} > ${doc.optString("screen")}: ${doc.optString("path")}"
            lines += "  ${doc.optString("purpose")}"
        }
        lines += ""
        lines += "Actions"
        val actions = manifest.optJSONArray("actions") ?: JSONArray()
        for (index in 0 until actions.length()) {
            val action = actions.getJSONObject(index)
            lines += "- ${action.optString("name")} (${action.optString("type")}/${action.optString("risk")})"
        }
        lines += ""
        lines += "Navigation"
        navigationRegistry.all().forEach { target ->
            lines += "- ${target.routeId}: ${target.label}"
        }
        return lines.joinToString("\n")
    }

    fun auditManifest(manifest: JSONObject = buildDefaultManifest()): JSONObject {
        val blocked = JSONArray()
        val warnings = JSONArray()
        val seenDocs = mutableSetOf<String>()
        val seenActions = mutableSetOf<String>()
        val seenRoutes = mutableSetOf<String>()
        val docs = manifest.optJSONArray("documents") ?: JSONArray()
        val actions = manifest.optJSONArray("actions") ?: JSONArray()

        for (index in 0 until docs.length()) {
            val doc = docs.optJSONObject(index) ?: continue
            val key = doc.optString("externalKey")
            val routeId = doc.optJSONObject("navigation")?.optString("routeId").orEmpty()
            if (key.isBlank()) blocked.put(issue("document_missing_key", "Document is missing externalKey.", index))
            if (key.isNotBlank() && !seenDocs.add(key)) blocked.put(issue("duplicate_document", "Duplicate document externalKey: $key", index))
            if (doc.optString("purpose").isBlank()) warnings.put(issue("missing_purpose", "Document is missing purpose: $key", index))
            if ((doc.optJSONArray("steps")?.length() ?: 0) < 2) warnings.put(issue("short_steps", "Document has too few steps: $key", index))
            if (looksSensitive(doc.toString())) blocked.put(issue("sensitive_document", "Document appears to contain a secret or payment value: $key", index))
            if (routeId.isNotBlank()) {
                if (!seenRoutes.add(routeId)) blocked.put(issue("duplicate_route", "Duplicate routeId: $routeId", index))
                if (!navigationRegistry.has(routeId)) warnings.put(issue("unwired_route", "No local navigation opener is registered for routeId: $routeId", index))
            }
        }

        for (index in 0 until actions.length()) {
            val action = actions.optJSONObject(index) ?: continue
            val name = action.optString("name")
            val type = action.optString("type")
            val risk = action.optString("risk")
            val enabled = action.optBoolean("enabled", true)
            if (!name.matches(Regex("^[a-z][a-z0-9_]*$"))) blocked.put(issue("bad_action_name", "Action name must be snake_case: $name", index))
            if (name.isNotBlank() && !seenActions.add(name)) blocked.put(issue("duplicate_action", "Duplicate action name: $name", index))
            if (enabled && !actionRegistry.has(name)) blocked.put(issue("missing_handler", "No local handler is registered for action: $name", index))
            if (type in setOf("create", "update", "danger") && !action.optBoolean("needsConfirmation", false)) {
                blocked.put(issue("confirmation_required", "Write action must require confirmation: $name", index))
            }
            if (type == "danger" && enabled) blocked.put(issue("danger_enabled", "Danger action must be disabled by default: $name", index))
            if (risk == "high" && action.optJSONArray("allowedRoles")?.length() == 0) {
                blocked.put(issue("roles_required", "High-risk action must define allowed roles: $name", index))
            }
        }

        return JSONObject()
            .put("ok", blocked.length() == 0)
            .put("blocked", blocked)
            .put("warnings", warnings)
    }

    fun diffManifest(previous: JSONObject?, next: JSONObject): JSONObject {
        if (previous == null) {
            return JSONObject()
                .put("documents", JSONObject().put("new", keys(next, "documents", "externalKey")).put("updated", JSONArray()).put("removed", JSONArray()))
                .put("actions", JSONObject().put("new", keys(next, "actions", "name")).put("updated", JSONArray()).put("removed", JSONArray()))
        }
        return JSONObject()
            .put("documents", diffArray(previous, next, "documents", "externalKey"))
            .put("actions", diffArray(previous, next, "actions", "name"))
    }

    private fun connectWebSocket(appVersion: String) {
        activeDeliveryMode = "websocket"
        reportHealth("websocket_reconnect_attempt", "info", "Opening Android active-session WebSocket.")

        val request = Request.Builder()
            .url(socketUrl())
            .addHeader("Authorization", "Bearer ${tokenProvider.getToken()}")
            .addHeader("X-Helpdesk-Platform", "android")
            .addHeader("X-Helpdesk-App-Version", appVersion)
            .build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                activeDeliveryMode = "websocket"
                idlePollSeconds = pollIntervalSeconds
                reconnectDelaySeconds = 2
                reconnectTask?.cancel(false)
                reconnectTask = null
                pollingTask?.cancel(false)
                webSocket.send(JSONObject().put("type", "hello").put("appVersion", appVersion).toString())
                reportHealth("websocket_connected", "success", "Android active helpdesk session connected.")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleSocketMessage(webSocket, text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                handleSocketMessage(webSocket, bytes.utf8())
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                reportHealth("websocket_disconnected", "info", reason.ifBlank { "WebSocket closed." })
                if (activeSession) {
                    startPollingFallback("websocket_closed")
                    scheduleWebSocketReconnect(appVersion)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                reportHealth(
                    "websocket_reconnect_failed",
                    "error",
                    t.message ?: "WebSocket failed; using polling fallback."
                )
                if (activeSession) {
                    startPollingFallback("websocket_failed")
                    scheduleWebSocketReconnect(appVersion)
                }
            }
        })
    }

    private fun handleSocketMessage(socket: WebSocket, text: String) {
        try {
            val payload = JSONObject(text)
            when (payload.optString("type", "event")) {
                "ping" -> socket.send(JSONObject().put("type", "pong").toString())
                "sync_required" -> syncPosManifest()
                "events" -> {
                    val events = payload.optJSONArray("events") ?: JSONArray()
                    for (index in 0 until events.length()) handleEvent(events.getJSONObject(index), "websocket", socket)
                }
                else -> handleEvent(payload.optJSONObject("event") ?: payload, "websocket", socket)
            }
        } catch (error: Throwable) {
            reportHealth("event_failed", "error", error.message ?: "Invalid WebSocket message.")
        }
    }

    private fun startPollingFallback(reason: String) {
        activeDeliveryMode = "polling_fallback"
        reportHealth("fallback_started", "info", "WebSocket unavailable; using safe polling fallback: $reason")
        pollingTask?.cancel(false)
        scheduleNextPoll(1)
    }

    private fun scheduleWebSocketReconnect(appVersion: String) {
        if (!activeSession) return
        reconnectTask?.cancel(false)
        val delay = reconnectDelaySeconds
        reconnectDelaySeconds = min(reconnectDelaySeconds * 2, 120)
        reconnectTask = executor.schedule({
            if (!activeSession) return@schedule
            reportHealth("websocket_reconnect_attempt", "info", "Retrying WebSocket after ${delay}s.")
            connectWebSocket(appVersion)
        }, delay.toLong(), TimeUnit.SECONDS)
    }

    private fun scheduleNextPoll(delaySeconds: Int) {
        if (!activeSession) return
        pollingTask = executor.schedule({
            val count = pollOnce()
            idlePollSeconds = if (count > 0) pollIntervalSeconds else min(idlePollSeconds * 2, 300)
            scheduleNextPoll(idlePollSeconds)
        }, delaySeconds.toLong(), TimeUnit.SECONDS)
    }

    private fun handleEvent(event: JSONObject, deliveryMode: String, socket: WebSocket? = null) {
        val eventId = event.optString("id")
        val name = event.optString("name")
        val input = event.optJSONObject("input") ?: JSONObject()
        val eventStarted = System.currentTimeMillis()
        acknowledgeEvent(eventId, name, deliveryMode, socket)

        try {
            val result = actionRegistry.run(name, input)
            sendEventResult(
                eventId = eventId,
                status = "completed",
                response = safeResult(result),
                error = null,
                deliveryMode = deliveryMode,
                durationMs = (System.currentTimeMillis() - eventStarted).toInt(),
                socket = socket
            )
        } catch (error: Throwable) {
            if (!actionRegistry.has(name)) {
                reportHealth("handler_missing", "error", error.message ?: "Unsupported event: $name", eventId, name)
            }
            sendEventResult(
                eventId = eventId,
                status = "failed",
                response = null,
                error = error.message ?: "Event failed.",
                deliveryMode = deliveryMode,
                durationMs = (System.currentTimeMillis() - eventStarted).toInt(),
                socket = socket
            )
        }
    }

    private fun acknowledgeEvent(eventId: String, actionName: String, deliveryMode: String, socket: WebSocket?) {
        reportHealth("event_acknowledged", "success", eventId = eventId, actionName = actionName)
        socket?.send(
            JSONObject()
                .put("type", "ack")
                .put("eventId", eventId)
                .put("deliveryMode", deliveryMode)
                .toString()
        )
    }

    private fun sendEventResult(
        eventId: String,
        status: String,
        response: JSONObject?,
        error: String?,
        deliveryMode: String,
        durationMs: Int,
        socket: WebSocket?
    ) {
        val payload = JSONObject()
            .put("type", "result")
            .put("eventId", eventId)
            .put("status", status)
            .put("response", response)
            .put("error", error)
            .put("deliveryMode", deliveryMode)
            .put("durationMs", durationMs)

        if (socket != null && activeDeliveryMode == "websocket") {
            socket.send(payload.toString())
        } else {
            request("POST", "/api/helpdesk/connectors/events", payload)
        }
    }

    private fun handleSyncCommand(response: JSONObject) {
        val serverRevision = response.optInt("manifestRevision", knownRevision)
        if (response.optBoolean("syncRequired", false) || serverRevision > knownRevision) {
            syncPosManifest()
            knownRevision = serverRevision
        }
    }

    private fun reportHealth(
        eventType: String,
        status: String,
        message: String? = null,
        eventId: String? = null,
        actionName: String? = null,
        durationMs: Int? = null,
        eventsReturned: Int? = null,
        pollIntervalSeconds: Int? = null
    ) {
        try {
            request(
                "POST",
                "/api/helpdesk/connectors/health",
                JSONObject()
                    .put("eventType", eventType)
                    .put("deliveryMode", activeDeliveryMode)
                    .put("status", status)
                    .put("message", message)
                    .put("eventId", eventId)
                    .put("actionName", actionName)
                    .put("durationMs", durationMs)
                    .put("eventsReturned", eventsReturned)
                    .put("pollIntervalSeconds", pollIntervalSeconds)
                    .put("metadata", JSONObject().put("app", "android-pos-starter"))
            )
        } catch (_: Throwable) {
            // Health logging should never crash the customer's POS app.
        }
    }

    private fun request(method: String, path: String, body: JSONObject? = null, maxAttempts: Int = 3): JSONObject {
        var lastError: Throwable? = null
        var delayMs = 500L
        repeat(maxAttempts) { attempt ->
            try {
                return requestOnce(method, path, body)
            } catch (error: Throwable) {
                lastError = error
                if (attempt < maxAttempts - 1) {
                    Thread.sleep(delayMs)
                    delayMs = min(delayMs * 2, 5_000L)
                }
            }
        }
        throw lastError ?: IOException("Connector API request failed.")
    }

    private fun requestOnce(method: String, path: String, body: JSONObject? = null): JSONObject {
        val builder = Request.Builder()
            .url(httpUrl(path))
            .addHeader("Authorization", "Bearer ${tokenProvider.getToken()}")
            .addHeader("Content-Type", "application/json")

        val requestBody = body?.toString()?.toRequestBody(jsonMediaType)
        val request = when (method.uppercase(Locale.US)) {
            "GET" -> builder.get().build()
            "POST" -> builder.post(requestBody ?: ByteArray(0).toRequestBody(jsonMediaType)).build()
            else -> builder.method(method, requestBody).build()
        }

        httpClient.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException("Connector API error ${response.code}: $text")
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun httpUrl(path: String): String {
        return baseUrl.trimEnd('/') + path
    }

    private fun socketUrl(): String {
        val root = (socketBaseUrl ?: baseUrl).trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        return "$root/api/helpdesk/connectors/socket"
    }

    private fun buildDefaultManifest(appVersion: String = "android-pos-starter-1.0"): JSONObject {
        val stockRoute = "inventory.stock_adjustment"
        val salesRoute = "reports.daily_sales"
        val actions = JSONArray()
        actionRegistry.definitions().forEach { actions.put(it.toJson()) }

        return JSONObject()
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
                            .put("steps", JSONArray(listOf("Open Inventory.", "Tap Stock Adjustment.", "Search or scan the product.", "Enter the new quantity.", "Tap Save.")))
                            .put("fields", JSONArray(listOf(field("Product", true, "Product selected by search or barcode."), field("Quantity", true, "New stock quantity."))))
                            .put("commonErrors", JSONArray(listOf("Quantity cannot be negative.", "Only manager or admin can update stock.")))
                            .put("actions", JSONArray(listOf("search_product", "update_product_quantity")))
                            .put("navigation", navigationRegistry.all().find { it.routeId == stockRoute }?.toJson() ?: defaultNavigation("Open Stock Adjustment", stockRoute, "inventory/stock-adjustment", "mypos://inventory/stock-adjustment"))
                            .put("needsReview", false)
                    )
                    .put(
                        JSONObject()
                            .put("externalKey", "reports.daily-sales")
                            .put("module", "Reports")
                            .put("screen", "Daily Sales")
                            .put("path", "Reports > Daily Sales")
                            .put("purpose", "Show daily sales summary from the Android POS app.")
                            .put("steps", JSONArray(listOf("Open Reports.", "Tap Daily Sales.", "Choose the date.", "Tap Generate.")))
                            .put("fields", JSONArray(listOf(field("Date", true, "Report date."), field("Branch", false, "Optional branch filter."))))
                            .put("commonErrors", JSONArray(listOf("No sales appear if the date has no completed orders.")))
                            .put("actions", JSONArray(listOf("daily_sales_report", "end_of_day_report")))
                            .put("navigation", navigationRegistry.all().find { it.routeId == salesRoute }?.toJson() ?: defaultNavigation("Open Daily Sales", salesRoute, "reports/daily-sales", "mypos://reports/daily-sales"))
                            .put("needsReview", false)
                    )
            )
            .put("actions", actions)
    }

    private fun safeResult(result: JSONObject): JSONObject {
        val redacted = redactObject(result)
        val text = redacted.toString()
        if (text.toByteArray(Charsets.UTF_8).size <= maxResultBytes) return redacted
        return JSONObject()
            .put("truncated", true)
            .put("message", "Connector result exceeded the safe result size limit.")
            .put("preview", text.take(maxResultBytes / 2))
    }

    private fun redactObject(input: JSONObject): JSONObject {
        val output = JSONObject()
        val keys = input.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            output.put(key, redactValue(key, input.opt(key)))
        }
        return output
    }

    private fun redactArray(input: JSONArray): JSONArray {
        val output = JSONArray()
        for (index in 0 until input.length()) output.put(redactValue("", input.opt(index)))
        return output
    }

    private fun redactValue(key: String, value: Any?): Any? {
        if (key.lowercase(Locale.US).contains(Regex("password|token|secret|api[_-]?key|card|cvv|pin"))) {
            return "[redacted]"
        }
        return when (value) {
            is JSONObject -> redactObject(value)
            is JSONArray -> redactArray(value)
            is String -> if (value.length > 500) value.take(500) + "..." else value
            else -> value
        }
    }

    private fun looksSensitive(text: String): Boolean {
        return text.contains(Regex("(?i)(password|api[_-]?key|secret|bearer\\s+[a-z0-9._-]+|connectionstring|cvv|card number|private key)"))
    }

    private fun issue(code: String, message: String, index: Int): JSONObject {
        return JSONObject().put("code", code).put("message", message).put("index", index)
    }

    private fun keys(manifest: JSONObject, arrayKey: String, itemKey: String): JSONArray {
        val out = JSONArray()
        val items = manifest.optJSONArray(arrayKey) ?: JSONArray()
        for (index in 0 until items.length()) out.put(items.getJSONObject(index).optString(itemKey))
        return out
    }

    private fun diffArray(previous: JSONObject, next: JSONObject, arrayKey: String, itemKey: String): JSONObject {
        val before = toMap(previous.optJSONArray(arrayKey), itemKey)
        val after = toMap(next.optJSONArray(arrayKey), itemKey)
        val added = JSONArray()
        val updated = JSONArray()
        val removed = JSONArray()

        after.forEach { (key, value) ->
            if (!before.containsKey(key)) added.put(key) else if (before[key] != value) updated.put(key)
        }
        before.keys.filter { !after.containsKey(it) }.forEach { removed.put(it) }
        return JSONObject().put("new", added).put("updated", updated).put("removed", removed)
    }

    private fun toMap(items: JSONArray?, itemKey: String): Map<String, String> {
        val out = linkedMapOf<String, String>()
        if (items == null) return out
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val key = item.optString(itemKey)
            if (key.isNotBlank()) out[key] = item.toString()
        }
        return out
    }

    private fun field(name: String, required: Boolean, description: String): JSONObject {
        return JSONObject().put("name", name).put("required", required).put("description", description)
    }

    private fun defaultNavigation(label: String, routeId: String, route: String, deepLink: String): JSONObject {
        return HelpdeskNavigationTarget(routeId, label, route, deepLink).toJson()
    }

    companion object {
        private fun registryFromHandlers(handlers: Map<String, (JSONObject) -> JSONObject>): HelpdeskActionRegistry {
            val registry = HelpdeskActionRegistry(HelpdeskRoleProvider { "admin" })
            val library = standardActionLibrary().associateBy { it.name }
            handlers.forEach { (name, handler) ->
                registry.register(
                    library[name] ?: HelpdeskActionDefinition(name, "Custom local action.", "read", "low"),
                    HelpdeskActionHandler { input -> handler(input) }
                )
            }
            return registry
        }

        fun standardActionLibrary(): List<HelpdeskActionDefinition> {
            return listOf(
                HelpdeskActionDefinition("search_product", "Search products by name, SKU, or barcode.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("get_product", "Return one product by id.", "read", "low", listOf("product_id"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("create_product", "Create a new product.", "create", "medium", listOf("name", "sku", "price"), listOf("opening_stock"), needsConfirmation = true),
                HelpdeskActionDefinition("update_product", "Update product fields.", "update", "medium", listOf("product_id"), listOf("name", "sku", "price"), needsConfirmation = true),
                HelpdeskActionDefinition("update_product_price", "Update product sale price.", "update", "medium", listOf("product_id", "price"), listOf("reason"), needsConfirmation = true),
                HelpdeskActionDefinition("update_product_quantity", "Update stock quantity for one product.", "update", "medium", listOf("product_id", "quantity"), listOf("reason"), needsConfirmation = true),
                HelpdeskActionDefinition("disable_product", "Disable a product.", "update", "high", listOf("product_id", "reason"), needsConfirmation = true),
                HelpdeskActionDefinition("check_stock", "Return stock quantity for a product.", "read", "low", listOf("product_id"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("low_stock_products", "List low-stock products.", "report", "low", optionalFields = listOf("threshold"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("stock_adjustment_history", "Return stock adjustment history.", "report", "low", listOf("product_id"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("search_customer", "Search customers by name or phone.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("create_customer", "Create a customer.", "create", "medium", listOf("name"), listOf("phone", "email"), needsConfirmation = true),
                HelpdeskActionDefinition("update_customer", "Update customer fields.", "update", "medium", listOf("customer_id"), listOf("name", "phone", "email"), needsConfirmation = true),
                HelpdeskActionDefinition("update_customer_phone", "Update customer phone.", "update", "medium", listOf("customer_id", "phone"), needsConfirmation = true),
                HelpdeskActionDefinition("search_order", "Search orders.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("get_order_status", "Return order status.", "read", "low", listOf("order_id"), allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("create_order", "Create an order.", "create", "medium", listOf("items"), listOf("customer_id"), needsConfirmation = true),
                HelpdeskActionDefinition("cancel_order", "Cancel an order.", "danger", "high", listOf("order_id", "reason"), needsConfirmation = true, enabled = false),
                HelpdeskActionDefinition("search_invoice", "Search invoices.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("get_invoice", "Return invoice summary.", "read", "low", listOf("invoice_id"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("daily_sales_report", "Return sales summary for a date.", "report", "low", listOf("date"), listOf("branch_id"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("end_of_day_report", "Return end-of-day close summary.", "report", "low", listOf("date"), listOf("branch_id"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("stock_value_report", "Return stock valuation.", "report", "low", optionalFields = listOf("branch_id"), allowedRoles = listOf("admin", "manager")),
                HelpdeskActionDefinition("create_support_ticket", "Create an internal support ticket.", "create", "low", listOf("title", "description"), needsConfirmation = true, allowedRoles = listOf("admin", "manager", "cashier")),
                HelpdeskActionDefinition("add_customer_note", "Add a note to a customer.", "create", "medium", listOf("customer_id", "note"), needsConfirmation = true)
            )
        }
    }
}
