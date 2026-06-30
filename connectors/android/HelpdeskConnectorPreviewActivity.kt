package com.switchsave.helpdesk

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.graphics.drawable.GradientDrawable
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
    private lateinit var questionInput: EditText
    private lateinit var routeInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(51, 65, 85))
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

        questionInput = EditText(this).apply {
            hint = "Ask the assistant anything..."
            minLines = 3
            setSingleLine(false)
        }

        routeInput = EditText(this).apply {
            hint = "Route ID, e.g. inventory.products"
            setSingleLine(true)
        }

        val setupActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(actionButton("Save key") { saveTokenAndRegisterPreviewConnector() })
            addView(actionButton("Preview") { renderPreview() })
            addView(actionButton("Audit") { renderAudit() })
            addView(actionButton("Sync") { syncManifest() })
        }

        val routeActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(actionButton("Test route") { testRoute() })
            addView(actionButton("Setup guide") { renderSetupGuide() })
        }

        val questionActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(actionButton("Ask") { askAssistant() })
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 28, 28, 28)
            setBackgroundColor(Color.rgb(248, 250, 252))

            addView(panel {
                addView(topBar())
                addView(hero())
                quickQuestion("How do I add product?")
                quickQuestion("Check stock")
                quickQuestion("Update product price")
                quickQuestion("Create purchase order")
                quickQuestion("Daily sales report")
                addView(chips())
                addView(questionInput)
                addView(questionActions)
            })

            addView(sectionTitle("Connector setup"))
            addView(panel {
                addView(helpText("Paste the Base URL and hdk_ token once, then Preview, Audit, and Sync. This screen uses the same default chat design the staff will see."))
                addView(baseUrlInput)
                addView(tokenInput)
                addView(setupActions)
            })

            addView(sectionTitle("Routes"))
            addView(panel {
                addView(helpText("Add routes in HelpdeskAndroidAppDetails.kt -> buildNavigation(...). Test a routeId here before syncing. A pass means your local navigation callback is wired."))
                addView(routeInput)
                addView(routeActions)
            })

            addView(sectionTitle("Result"))
            addView(panel {
                addView(output, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            })
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
                    routeId = "dashboard.main",
                    label = "Open Dashboard",
                    route = "dashboard",
                    open = { output.text = "Route OK: dashboard.main -> dashboard" }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "inventory.products",
                    label = "Open Products",
                    route = "inventory/products",
                    open = { output.text = "Route OK: inventory.products -> inventory/products" }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "inventory.stock_adjustment",
                    label = "Open Stock Adjustment",
                    route = "inventory/stock-adjustment",
                    open = { output.text = "Route OK: inventory.stock_adjustment -> inventory/stock-adjustment" }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "reports.daily_sales",
                    label = "Open Daily Sales",
                    route = "reports/daily-sales",
                    open = { output.text = "Route OK: reports.daily_sales -> reports/daily-sales" }
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

    private fun askAssistant() {
        output.text = runCatching {
            val text = questionInput.text.toString().trim()
            require(text.isNotBlank()) { "Type a staff question first." }
            connector()
            "Question ready: \"$text\"\n\nFor production chat, create HelpdeskChatController and call helpdeskChat.ask(text) from your staff-only Activity/Fragment."
        }.getOrElse { "Ask failed: ${it.message}" }
    }

    private fun testRoute() {
        output.text = runCatching {
            val routeId = routeInput.text.toString().trim()
            require(routeId.isNotBlank()) { "Enter a routeId such as inventory.products." }
            val ok = connector().openNavigationTarget(routeId)
            if (ok) {
                "Route verified: $routeId\n\nThis routeId has a local navigation callback. Now add the same routeId to the matching document.navigation.routeId in HelpdeskAndroidAppDetails.kt."
            } else {
                "Route not wired: $routeId\n\nAdd it in HelpdeskAndroidAppDetails.kt -> buildNavigation(...), then map it to navController.navigate(...), an Activity, Fragment, or deep link."
            }
        }.getOrElse { "Route test failed: ${it.message}" }
    }

    private fun renderAudit() {
        output.text = runCatching { connector().auditManifest().toString(2) }
            .getOrElse { "Audit failed: ${it.message}" }
    }

    private fun syncManifest() {
        runOutputInBackground("Sync") {
            val response = connector().syncPosManifest()
            "Sync complete.\n\nDocuments/actions were sent to Switch&Save as drafts.\n\n${response.toString(2)}"
        }
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
            - Verify it here with Test route before Sync.

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

    private fun topBar(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, 18)
            addView(chip("Chat", true))
            addView(chip("History", false))
            addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
                text = "      *   >"
                textSize = 22f
                setTextColor(Color.rgb(99, 62, 243))
            })
        }
    }

    private fun hero(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 26, 0, 20)
            addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
                text = "[bot]"
                textSize = 34f
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.WHITE)
                background = rounded(Color.rgb(99, 62, 243), 22f)
                setPadding(20, 14, 20, 14)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = android.view.Gravity.CENTER_HORIZONTAL
            })
            addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
                text = "Hello Aamir"
                textSize = 24f
                typeface = Typeface.DEFAULT_BOLD
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.rgb(15, 23, 42))
                setPadding(0, 18, 0, 8)
            })
            addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
                text = "How can the assistant help you today?"
                textSize = 16f
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.rgb(71, 85, 105))
            })
        }
    }

    private fun LinearLayout.quickQuestion(text: String) {
        addView(TextView(this@HelpdeskConnectorPreviewActivity).apply {
            this.text = "*  $text"
            textSize = 16f
            setTextColor(Color.rgb(30, 41, 59))
            setPadding(8, 18, 8, 18)
            setOnClickListener {
                questionInput.setText(text)
                askAssistant()
            }
        })
    }

    private fun chips(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 10, 0, 18)
            addView(chip("* For You", true))
            addView(chip("Products", false))
            addView(chip("Reports", false))
            addView(chip("Stock", false))
            addView(chip("Customers", false))
        }
    }

    private fun chip(text: String, selected: Boolean): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 14f
            setTextColor(if (selected) Color.rgb(99, 62, 243) else Color.rgb(71, 85, 105))
            typeface = if (selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            setPadding(20, 12, 20, 12)
            background = rounded(Color.WHITE, 32f, if (selected) Color.rgb(124, 92, 255) else Color.rgb(226, 232, 240))
        }
    }

    private fun panel(build: LinearLayout.() -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(26, 26, 26, 26)
            background = rounded(Color.WHITE, 16f, Color.rgb(226, 232, 240))
            build()
        }
    }

    private fun sectionTitle(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.rgb(15, 23, 42))
            setPadding(4, 28, 4, 10)
        }
    }

    private fun helpText(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = 14f
            setTextColor(Color.rgb(71, 85, 105))
            setPadding(0, 0, 0, 16)
        }
    }

    private fun actionButton(text: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            this.text = text
            setOnClickListener { onClick() }
        }
    }

    private fun runOutputInBackground(label: String, work: () -> String) {
        output.text = "$label running..."
        Thread {
            val result = runCatching { work() }
                .getOrElse { "$label failed: ${formatError(it)}" }
            runOnUiThread { output.text = result }
        }.start()
    }

    private fun formatError(error: Throwable): String {
        val message = error.message?.trim()
        if (!message.isNullOrBlank()) return message
        return when (error::class.java.simpleName) {
            "NetworkOnMainThreadException" -> "Android blocked a network call on the main thread. This connector now runs Sync in the background; try again."
            else -> "${error::class.java.simpleName}. Check Base URL, hdk_ token, network access, and server logs."
        }
    }

    private fun rounded(fill: Int, radius: Float, stroke: Int? = null): GradientDrawable {
        return GradientDrawable().apply {
            setColor(fill)
            cornerRadius = radius
            if (stroke != null) setStroke(2, stroke)
        }
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val DEFAULT_BASE_URL = "https://chatbot.ssepos.co.uk"
    }
}
