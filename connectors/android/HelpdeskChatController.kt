package com.switchsave.helpdesk

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class HelpdeskChatSettings(
    val enabled: Boolean = true,
    val showMode: String = "floating",
    val allowedRoles: List<String> = emptyList(),
    val allowedRoutes: List<String> = emptyList(),
    val blockedRoutes: List<String> = listOf("login", "payment", "checkout", "customer-facing/*", "customer-display/*"),
    val autoOpen: Boolean = false,
    val position: String = "right"
)

class HelpdeskChatController(
    private val baseUrl: String,
    private val tokenProvider: HelpdeskTokenProvider,
    private val staffRoleProvider: () -> String,
    private val currentRouteProvider: () -> String,
    private val navigationRegistry: HelpdeskNavigationRegistry,
    private val httpClient: OkHttpClient = OkHttpClient()
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun shouldShow(settings: HelpdeskChatSettings): Boolean {
        val route = normalizeRoute(currentRouteProvider())
        if (!settings.enabled || settings.showMode == "hidden") return false
        if (route.isBlank()) return true
        if (settings.blockedRoutes.any { routeMatches(it, route) }) return false
        if (settings.allowedRoutes.isEmpty()) return true
        return settings.allowedRoutes.any { routeMatches(it, route) }
    }

    fun ask(text: String): JSONObject {
        val body = JSONObject()
            .put("text", text)
            .put("currentRoute", currentRouteProvider())
            .put("staffRole", staffRoleProvider())
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/helpdesk/chat")
            .addHeader("Authorization", "Bearer ${tokenProvider.getToken()}")
            .post(body.toString().toRequestBody(jsonMediaType))
            .build()
        httpClient.newCall(request).execute().use { response ->
            val responseText = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching { JSONObject(responseText).optString("message") }.getOrNull()
                error(message?.takeIf { it.isNotBlank() } ?: "Help Desk chat failed ${response.code}")
            }
            return JSONObject(responseText)
        }
    }

    fun openRoute(routeId: String): Boolean {
        return navigationRegistry.open(routeId)
    }

    private fun normalizeRoute(route: String): String {
        return route.trim().trim('/').lowercase()
    }

    private fun routeMatches(pattern: String, route: String): Boolean {
        val p = normalizeRoute(pattern)
        if (p == "*") return true
        if (p.endsWith("/*")) return route == p.removeSuffix("/*") || route.startsWith(p.removeSuffix("*"))
        return route == p || route.contains(p)
    }
}
