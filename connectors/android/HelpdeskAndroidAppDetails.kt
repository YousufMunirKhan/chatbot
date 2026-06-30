package com.switchsave.helpdesk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Fill this file with the CUSTOMER APP'S real details.
 *
 * This is the file Android developers should edit first. The preview screen can
 * save the hdk_ key and smoke-test the SDK, but production only becomes useful
 * after these five pieces are mapped to the real POS/admin app:
 *
 * 1. Screens: every staff screen the bot should explain or open.
 * 2. Navigation: routeId -> actual Android navigation callback.
 * 3. Actions: approved bot action -> real repository/service method.
 * 4. Roles: current staff role for permission checks.
 * 5. Staff Help Desk screen: where the chat bubble/panel appears.
 */
object HelpdeskAndroidAppDetails {

    /**
     * Create the production connector. Call this from a staff/admin-only screen.
     */
    fun createConnector(
        context: Context,
        baseUrl: String,
        productRepository: ProductRepository,
        reportRepository: ReportRepository,
        currentStaffRole: () -> String?,
        openScreen: (route: String) -> Unit
    ): HelpdeskConnectorClient {
        val tokenStore = HelpdeskEncryptedTokenStore(context)

        val navigation = buildNavigation(openScreen)
        val actions = buildActions(productRepository, reportRepository, currentStaffRole)

        return HelpdeskConnectorClient(
            baseUrl = baseUrl,
            tokenProvider = tokenStore,
            actionRegistry = actions,
            navigationRegistry = navigation,
            manifestStore = HelpdeskAndroidManifestStore(context),
            manifestProvider = { appVersion ->
                buildManifest(
                    appVersion = appVersion,
                    actions = actions.definitions(),
                    navigation = navigation
                )
            }
        )
    }

    /**
     * Add one target for each screen the bot can open.
     *
     * routeId must match the document.navigation.routeId in buildManifest().
     */
    fun buildNavigation(openScreen: (route: String) -> Unit): HelpdeskNavigationRegistry {
        return HelpdeskNavigationRegistry()
            .register(
                HelpdeskNavigationTarget(
                    routeId = "dashboard.main",
                    label = "Open Dashboard",
                    route = "dashboard",
                    deepLink = "mypos://dashboard",
                    open = { openScreen("dashboard") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "inventory.products",
                    label = "Open Products",
                    route = "inventory/products",
                    deepLink = "mypos://inventory/products",
                    open = { openScreen("inventory/products") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "reports.daily_sales",
                    label = "Open Daily Sales",
                    route = "reports/daily-sales",
                    deepLink = "mypos://reports/daily-sales",
                    open = { openScreen("reports/daily-sales") }
                )
            )
    }

    /**
     * Register only actions the app can really perform.
     *
     * Read actions can return small summaries. Write actions must be protected
     * by role checks and confirmation.
     */
    fun buildActions(
        products: ProductRepository,
        reports: ReportRepository,
        currentStaffRole: () -> String?
    ): HelpdeskActionRegistry {
        val library = HelpdeskConnectorClient.standardActionLibrary().associateBy { it.name }

        return HelpdeskActionRegistry(
            roleProvider = HelpdeskRoleProvider { currentStaffRole() }
        )
            .register(
                library.getValue("search_product"),
                HelpdeskActionHandler { input ->
                    val results = products.search(input.getString("query"))
                    JSONObject().put(
                        "results",
                        JSONArray(
                            results.map { product ->
                                JSONObject()
                                    .put("id", product.id)
                                    .put("name", product.name)
                                    .put("sku", product.sku)
                                    .put("price", product.price)
                                    .put("quantity", product.quantity)
                            }
                        )
                    )
                }
            )
            .register(
                library.getValue("check_stock"),
                HelpdeskActionHandler { input ->
                    val product = products.get(input.getString("product_id"))
                    JSONObject()
                        .put("id", product.id)
                        .put("name", product.name)
                        .put("quantity", product.quantity)
                        .put("in_stock", product.quantity > 0)
                }
            )
            .register(
                library.getValue("daily_sales_report"),
                HelpdeskActionHandler { input ->
                    reports.dailySales(input.optString("date"))
                }
            )
            .register(
                library.getValue("update_product_quantity"),
                HelpdeskActionHandler { input ->
                    // The SDK has already checked role + confirmed=true for this action.
                    val productId = input.getString("product_id")
                    val quantity = input.getInt("quantity")
                    products.updateQuantity(productId, quantity)
                    JSONObject()
                        .put("success", true)
                        .put("product_id", productId)
                        .put("quantity", quantity)
                }
            )
    }

    /**
     * This is what Switch&Save sees during Sync.
     *
     * Add one document for each real staff screen. Keep this factual: where the
     * screen is, what it does, which fields matter, common errors, and which
     * approved connector actions relate to it.
     */
    fun buildManifest(
        appVersion: String,
        actions: List<HelpdeskActionDefinition>,
        navigation: HelpdeskNavigationRegistry
    ): JSONObject {
        return JSONObject()
            .put("appVersion", appVersion)
            .put("clientRevision", 0)
            .put(
                "documents",
                JSONArray()
                    .put(
                        screenDoc(
                            externalKey = "dashboard.main",
                            module = "Dashboard",
                            screen = "Main Menu",
                            path = "Dashboard > Main Menu",
                            purpose = "Start orders, open management areas, review sync state, and access daily POS operations.",
                            steps = listOf("Log in as staff.", "Open Dashboard.", "Choose the required menu item."),
                            fields = listOf(field("Current branch", false, "Branch currently selected in the POS.")),
                            commonErrors = listOf("Staff role may hide manager-only menu items."),
                            actions = listOf("daily_sales_report"),
                            navigationTarget = navigation.all().first { it.routeId == "dashboard.main" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "inventory.products",
                            module = "Inventory",
                            screen = "Products",
                            path = "Inventory > Products",
                            purpose = "Search products, check stock, barcode, QR PLU, and inspect stock-related fields.",
                            steps = listOf("Open Inventory.", "Tap Products.", "Search by name, SKU, barcode, or QR PLU."),
                            fields = listOf(
                                field("Search", false, "Product name, SKU, barcode, or QR PLU."),
                                field("Quantity", false, "Current stock quantity."),
                                field("Sale price", false, "Current selling price.")
                            ),
                            commonErrors = listOf("No products appear when filters are too narrow."),
                            actions = listOf("search_product", "check_stock", "update_product_quantity"),
                            navigationTarget = navigation.all().first { it.routeId == "inventory.products" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "reports.daily_sales",
                            module = "Reports",
                            screen = "Daily Sales",
                            path = "Reports > Daily Sales",
                            purpose = "Review daily sales, order counts, cash/card totals, and end-of-day figures.",
                            steps = listOf("Open Reports.", "Tap Daily Sales.", "Select date and branch.", "Generate report."),
                            fields = listOf(
                                field("Date", true, "Report date."),
                                field("Branch", false, "Optional branch filter.")
                            ),
                            commonErrors = listOf("Report is empty when no completed orders exist for the selected date."),
                            actions = listOf("daily_sales_report"),
                            navigationTarget = navigation.all().first { it.routeId == "reports.daily_sales" }
                        )
                    )
            )
            .put("actions", JSONArray(actions.map { it.toJson() }))
    }

    private fun screenDoc(
        externalKey: String,
        module: String,
        screen: String,
        path: String,
        purpose: String,
        steps: List<String>,
        fields: List<JSONObject>,
        commonErrors: List<String>,
        actions: List<String>,
        navigationTarget: HelpdeskNavigationTarget
    ): JSONObject {
        return JSONObject()
            .put("externalKey", externalKey)
            .put("module", module)
            .put("screen", screen)
            .put("path", path)
            .put("purpose", purpose)
            .put("steps", JSONArray(steps))
            .put("fields", JSONArray(fields))
            .put("commonErrors", JSONArray(commonErrors))
            .put("actions", JSONArray(actions))
            .put("navigation", navigationTarget.toJson())
            .put("needsReview", false)
    }

    private fun field(name: String, required: Boolean, description: String): JSONObject {
        return JSONObject()
            .put("name", name)
            .put("required", required)
            .put("description", description)
    }
}

/**
 * Replace these interfaces with the app's real repositories/services.
 */
interface ProductRepository {
    fun search(query: String): List<HelpdeskProduct>
    fun get(productId: String): HelpdeskProduct
    fun updateQuantity(productId: String, quantity: Int)
}

interface ReportRepository {
    fun dailySales(date: String): JSONObject
}

data class HelpdeskProduct(
    val id: String,
    val name: String,
    val sku: String,
    val price: Double,
    val quantity: Int
)
