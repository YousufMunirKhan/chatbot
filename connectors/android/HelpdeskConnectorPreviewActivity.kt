package com.switchsave.helpdesk

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

object HelpdeskConnectorPreviewRegistry {
    var connectorProvider: (() -> HelpdeskConnectorClient)? = null

    /**
     * Call this from the customer's staff/admin app after you create the real
     * connector. This is the preferred production setup path because it uses
     * the app's real repositories, actions, and navigation callbacks.
     */
    fun configure(provider: () -> HelpdeskConnectorClient) {
        connectorProvider = provider
    }
}

class HelpdeskConnectorPreviewActivity : Activity() {
    private lateinit var output: TextView
    private lateinit var baseUrlInput: EditText
    private lateinit var tokenInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 14f
            setPadding(24, 24, 24, 24)
        }

        baseUrlInput = EditText(this).apply {
            hint = "Base URL, e.g. https://chatbot.ssepos.co.uk"
            setSingleLine(true)
            setText(savedBaseUrl())
        }

        tokenInput = EditText(this).apply {
            hint = "Connector token, starts with hdk_"
            setSingleLine(true)
        }

        val setupButton = Button(this).apply {
            text = "Save key"
            setOnClickListener { saveTokenAndRegisterPreviewConnector() }
        }
        val guideButton = Button(this).apply {
            text = "Setup guide"
            setOnClickListener { renderSetupGuide() }
        }
        val previewButton = Button(this).apply {
            text = "Preview"
            setOnClickListener { renderPreview() }
        }
        val auditButton = Button(this).apply {
            text = "Audit"
            setOnClickListener { renderAudit() }
        }
        val syncButton = Button(this).apply {
            text = "Sync"
            setOnClickListener { syncManifest() }
        }

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(setupButton)
            addView(guideButton)
            addView(previewButton)
            addView(auditButton)
            addView(syncButton)
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
                text = "Smoke test:\n" +
                    "1) Paste Base URL and hdk_ token.\n" +
                    "2) Press Save key.\n" +
                    "3) Press Preview, Audit, then Sync.\n\n" +
                    "Production:\n" +
                    "Edit HelpdeskAndroidAppDetails.kt with your real screens, actions, routes, and repositories."
                setPadding(24, 24, 24, 12)
            })
            addView(baseUrlInput)
            addView(tokenInput)
            addView(buttons)
            addView(output, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        setContentView(ScrollView(this).apply { addView(content) })
        renderPreview()
    }

    private fun connector(): HelpdeskConnectorClient {
        return HelpdeskConnectorPreviewRegistry.connectorProvider?.invoke()
            ?: error(
                "Connector is not configured yet.\n\n" +
                    "Paste the hdk_ connector token, confirm the Base URL, and press Save key.\n\n" +
                    "Production setup:\n" +
                    "HelpdeskConnectorPreviewRegistry.configure { connector }\n\n" +
                    "Open README.md or HelpdeskQuickStartExample.kt for the full setup."
            )
    }

    private fun saveTokenAndRegisterPreviewConnector() {
        output.text = runCatching {
            val baseUrl = baseUrlInput.text.toString().trim().trimEnd('/')
            val token = tokenInput.text.toString().trim()
            require(baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
                "Enter the Switch&Save base URL, for example https://chatbot.ssepos.co.uk"
            }
            require(token.startsWith("hdk_")) {
                "Enter the connector token from Help Desk. It must start with hdk_."
            }

            getPreferences(Context.MODE_PRIVATE).edit().putString(KEY_BASE_URL, baseUrl).apply()
            val tokenStore = HelpdeskEncryptedTokenStore(this)
            tokenStore.saveToken(token)
            HelpdeskConnectorPreviewRegistry.configure {
                starterPreviewConnector(baseUrl, tokenStore)
            }
            "Connector key saved.\n\nNext:\n- Press Preview to see the manifest.\n- Press Audit to find setup issues.\n- Press Sync to send docs/actions to Help Desk.\n\nThis uses starter/sample handlers only. For real customer details, edit HelpdeskAndroidAppDetails.kt and call HelpdeskAndroidAppDetails.createConnector(...)."
        }.getOrElse { "Setup failed: ${it.message}" }
    }

    private fun starterPreviewConnector(
        baseUrl: String,
        tokenStore: HelpdeskEncryptedTokenStore
    ): HelpdeskConnectorClient {
        val navigation = HelpdeskNavigationRegistry()
            .register(
                HelpdeskNavigationTarget(
                    routeId = "inventory.stock_adjustment",
                    label = "Open Stock Adjustment",
                    route = "inventory/stock-adjustment",
                    open = { output.text = "Open route requested: inventory/stock-adjustment" }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "reports.daily_sales",
                    label = "Open Daily Sales",
                    route = "reports/daily-sales",
                    open = { output.text = "Open route requested: reports/daily-sales" }
                )
            )

        val actions = HelpdeskActionRegistry(
            roleProvider = HelpdeskRoleProvider { "admin" }
        )
            .register(
                HelpdeskConnectorClient.standardActionLibrary().first { it.name == "search_product" },
                HelpdeskActionHandler { input ->
                    JSONObject()
                        .put("preview", true)
                        .put("message", "Replace this starter handler with your real product repository.")
                        .put("query", input.optString("query"))
                }
            )
            .register(
                HelpdeskConnectorClient.standardActionLibrary().first { it.name == "daily_sales_report" },
                HelpdeskActionHandler { input ->
                    JSONObject()
                        .put("preview", true)
                        .put("message", "Replace this starter handler with your real reports service.")
                        .put("date", input.optString("date"))
                }
            )

        return HelpdeskConnectorClient(
            baseUrl = baseUrl,
            tokenProvider = tokenStore,
            actionRegistry = actions,
            navigationRegistry = navigation,
            manifestStore = HelpdeskAndroidManifestStore(this)
        )
    }

    private fun savedBaseUrl(): String {
        return getPreferences(Context.MODE_PRIVATE).getString(KEY_BASE_URL, DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    }

    private fun renderPreview() {
        output.text = runCatching { connector().previewManifest() }
            .getOrElse { "Preview failed: ${it.message}" }
    }

    private fun renderAudit() {
        output.text = runCatching { connector().auditManifest().toString(2) }
            .getOrElse { "Audit failed: ${it.message}" }
    }

    private fun syncManifest() {
        output.text = runCatching { connector().syncPosManifest().toString(2) }
            .getOrElse { "Sync failed: ${it.message}" }
    }

    private fun renderSetupGuide() {
        output.text = """
            Android Help Desk setup guide

            1) Token setup screen
            - Create a connector in Switch&Save Help Desk.
            - Copy the one-time connector key. It starts with hdk_.
            - Paste it here and press Save key, or save it with HelpdeskEncryptedTokenStore.

            2) App details manifest
            - Edit HelpdeskAndroidAppDetails.kt.
            - For each real staff screen add:
              externalKey, module, screen, path, purpose, steps, fields, commonErrors, actions, navigation.routeId.
            - The preview sample is only a placeholder until this file matches the real app.

            3) Navigation callbacks
            - Add one routeId for each screen the bot can open.
            - Map routeId to the real app route, for example navController.navigate("inventory/products").

            4) Action handlers
            - Register only approved action names.
            - Map each action to a repository/service method, for example productRepository.search(query).
            - Write actions must use role checks and confirmed=true.

            5) Staff Help Desk screen
            - Add an authenticated staff-only Activity or Fragment.
            - Create the connector with HelpdeskAndroidAppDetails.createConnector(...).
            - Attach HelpdeskConnectorLifecycleObserver while that screen is open.
            - Render the chat panel/bubble for staff users only.

            6) Test
            - Press Preview to read the manifest.
            - Press Audit to find missing or unsafe setup.
            - Press Sync to send the manifest.
            - Ask a staff question and confirm the returned route/action works.
        """.trimIndent()
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val DEFAULT_BASE_URL = "https://chatbot.ssepos.co.uk"
    }
}
