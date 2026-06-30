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
 *
 * Important: the starter manifest below is a POS example. Use
 * docs/AUTO_DISCOVERY_PLAYBOOK.md with your AI agent to scan the real app menus
 * and replace these samples before production sync.
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
                    routeId = "inventory.add_product",
                    label = "Open Add Product",
                    route = "inventory/products/new",
                    deepLink = "mypos://inventory/products/new",
                    open = { openScreen("inventory/products/new") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "orders.list",
                    label = "Open Orders",
                    route = "orders",
                    deepLink = "mypos://orders",
                    open = { openScreen("orders") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "orders.create",
                    label = "Open New Order",
                    route = "orders/new",
                    deepLink = "mypos://orders/new",
                    open = { openScreen("orders/new") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "customers.list",
                    label = "Open Customers",
                    route = "customers",
                    deepLink = "mypos://customers",
                    open = { openScreen("customers") }
                )
            )
            .register(
                HelpdeskNavigationTarget(
                    routeId = "purchase_orders.create",
                    label = "Open Purchase Order",
                    route = "purchase/orders/new",
                    deepLink = "mypos://purchase/orders/new",
                    open = { openScreen("purchase/orders/new") }
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
            .register(
                HelpdeskNavigationTarget(
                    routeId = "settings.main",
                    label = "Open Settings",
                    route = "settings",
                    deepLink = "mypos://settings",
                    open = { openScreen("settings") }
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
                            externalKey = "inventory.add_product",
                            module = "Inventory",
                            screen = "Add Product",
                            path = "Inventory > Products > Add Product",
                            purpose = "Create a new POS product with name, SKU, barcode, sale price, tax, category, and opening stock.",
                            steps = listOf("Open Inventory.", "Tap Products.", "Tap Add Product.", "Enter product details.", "Save the product and confirm it appears in search."),
                            fields = listOf(
                                field("Product name", true, "Name shown on receipts, reports, and search."),
                                field("SKU/barcode", false, "Unique stock keeping unit or barcode."),
                                field("Sale price", true, "Selling price used at checkout."),
                                field("Opening stock", false, "Initial stock quantity.")
                            ),
                            commonErrors = listOf("SKU or barcode already exists.", "Price is required before saving.", "Tax/category may be required by the POS configuration."),
                            actions = listOf("search_product", "create_product"),
                            navigationTarget = navigation.all().first { it.routeId == "inventory.add_product" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "orders.list",
                            module = "Orders",
                            screen = "Order List",
                            path = "Orders > Order List",
                            purpose = "Search, review, print, refund, or check payment and fulfilment status for POS orders.",
                            steps = listOf("Open Orders.", "Search by order number, customer, date, or status.", "Open an order.", "Review items, totals, payment state, and fulfilment status."),
                            fields = listOf(
                                field("Search", false, "Order number, customer, or receipt reference."),
                                field("Date range", false, "Filter orders by date."),
                                field("Status", false, "Payment or fulfilment status.")
                            ),
                            commonErrors = listOf("Offline orders may appear after sync completes.", "Refund actions may require manager approval."),
                            actions = listOf("search_order", "get_order_status"),
                            navigationTarget = navigation.all().first { it.routeId == "orders.list" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "orders.create",
                            module = "Orders",
                            screen = "Create Order",
                            path = "Orders > New Order",
                            purpose = "Create a POS order by adding products, customer details, discounts, payment, and fulfilment information.",
                            steps = listOf("Open Orders.", "Choose New Order.", "Add products.", "Attach customer if required.", "Take payment or save the order."),
                            fields = listOf(
                                field("Product search", true, "Products to add to the order."),
                                field("Customer", false, "Optional customer linked to the order."),
                                field("Payment method", false, "Cash, card, account, or configured payment type.")
                            ),
                            commonErrors = listOf("Product is out of stock.", "Payment terminal is offline.", "Discount requires manager approval."),
                            actions = listOf("search_product", "create_order"),
                            navigationTarget = navigation.all().first { it.routeId == "orders.create" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "customers.list",
                            module = "Customers",
                            screen = "Customer Management",
                            path = "Customers > Customer Management",
                            purpose = "Find, create, or update customer records used for delivery, collection, account sales, and history.",
                            steps = listOf("Open Customers.", "Search by name, phone, or email.", "Open the customer record.", "Review details, notes, and order history."),
                            fields = listOf(
                                field("Search", false, "Name, phone, email, or customer code."),
                                field("Phone", false, "Customer phone number."),
                                field("Email", false, "Customer email address.")
                            ),
                            commonErrors = listOf("Duplicate customers may exist with similar phone numbers.", "Some customer data may be hidden by local privacy settings."),
                            actions = listOf("search_customer", "create_customer", "update_customer_phone"),
                            navigationTarget = navigation.all().first { it.routeId == "customers.list" }
                        )
                    )
                    .put(
                        screenDoc(
                            externalKey = "purchase_orders.create",
                            module = "Purchase",
                            screen = "Create Purchase Order",
                            path = "Purchase > Purchase Orders > New",
                            purpose = "Create a purchase order for suppliers, products, quantities, costs, and expected receiving dates.",
                            steps = listOf("Open Purchase.", "Open Purchase Orders.", "Choose New Purchase Order.", "Select supplier.", "Add products and quantities.", "Save or send the order."),
                            fields = listOf(
                                field("Supplier", true, "Supplier receiving the purchase order."),
                                field("Products", true, "Products and quantities to order."),
                                field("Expected date", false, "Expected delivery or receiving date.")
                            ),
                            commonErrors = listOf("Supplier is required.", "Product cost may be missing.", "Only manager/admin roles may create purchase orders."),
                            actions = listOf("create_purchase_order", "search_product"),
                            navigationTarget = navigation.all().first { it.routeId == "purchase_orders.create" }
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
                    .put(
                        screenDoc(
                            externalKey = "settings.main",
                            module = "Settings",
                            screen = "Settings",
                            path = "Settings",
                            purpose = "Configure POS, printers, payment terminals, tax, sync, staff, branch, and application settings.",
                            steps = listOf("Open Settings.", "Choose the setting category.", "Review current values.", "Save changes if permitted."),
                            fields = listOf(field("Setting category", false, "Printer, payment, tax, sync, staff, or branch settings.")),
                            commonErrors = listOf("Some settings require admin or manager permission.", "Printer/payment settings may require network or device connectivity."),
                            actions = emptyList(),
                            navigationTarget = navigation.all().first { it.routeId == "settings.main" }
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
