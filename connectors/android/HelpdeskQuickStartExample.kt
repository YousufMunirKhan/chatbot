package com.switchsave.helpdesk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  COMPLETE, COPY-PASTE QUICK START
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  This single file shows the WHOLE Help Desk connector wiring end-to-end.
 *  You only write the bodies of your action handlers (steps 3a/3b) — the SDK
 *  handles auth, sync, polling/WebSocket, required-field + role + confirmation
 *  checks, timeouts, and result redaction for you.
 *
 *  5 steps:
 *    1. Save the connector token (once, e.g. after the admin pastes it).
 *    2. Tell the bot how to open your screens (navigation).
 *    3. Register the actions the bot may run, mapped to YOUR repositories.
 *    4. Create the connector.
 *    5. Attach it to a lifecycle so it runs only while the help/admin screen
 *       is open (see ATTACH IN YOUR ACTIVITY at the bottom).
 *
 *  Replace `ProductRepository` with your real data layer. Nothing else changes.
 */
object HelpdeskQuickStart {

    /** Build a ready-to-run connector. Call this once and keep the result. */
    fun setup(
        context: Context,
        products: ProductRepository,
        currentStaffRole: () -> String?,
        openScreen: (route: String) -> Unit,
    ): HelpdeskConnectorClient {

        // 1) TOKEN — stored encrypted. Do this once, e.g. right after the admin
        //    pastes the hdk_… token from the dashboard. Safe to call again.
        val tokenStore = HelpdeskEncryptedTokenStore(context)
        // tokenStore.saveToken("hdk_...")   // ← uncomment the first time only

        // 2) NAVIGATION — when the bot suggests "Open Stock Adjustment", this is
        //    how your app actually navigates there.
        val navigation = HelpdeskNavigationRegistry().register(
            HelpdeskNavigationTarget(
                routeId = "inventory.stock_adjustment",
                label = "Open Stock Adjustment",
                route = "inventory/stock-adjustment",
                open = { openScreen("inventory/stock-adjustment") },
            ),
        )

        // 3) ACTIONS — pick the standard definition, then write the handler.
        //    The SDK validates required fields, role, and confirmation BEFORE
        //    your handler runs, so the body stays tiny.
        val actions = HelpdeskActionRegistry(
            roleProvider = HelpdeskRoleProvider { currentStaffRole() },
        )
            // 3a) A READ action — look something up, return a small result.
            .register(
                HelpdeskConnectorClient.standardActionLibrary().first { it.name == "search_product" },
                HelpdeskActionHandler { input ->
                    val matches = products.search(input.getString("query"))
                    JSONObject().put(
                        "results",
                        JSONArray(
                            matches.map { p ->
                                JSONObject()
                                    .put("id", p.id)
                                    .put("name", p.name)
                                    .put("sku", p.sku)
                                    .put("price", p.price)
                            },
                        ),
                    )
                },
            )
            // 3b) A WRITE action — the SDK already required confirmed=true and a
            //     permitted role before calling this, so just do the work.
            .register(
                HelpdeskConnectorClient.standardActionLibrary().first { it.name == "update_product_price" },
                HelpdeskActionHandler { input ->
                    val productId = input.getString("product_id")
                    val price = input.getDouble("price")
                    products.updatePrice(productId, price)
                    JSONObject()
                        .put("success", true)
                        .put("product_id", productId)
                        .put("price", price)
                },
            )

        // 4) CONNECTOR — wire it all together.
        return HelpdeskConnectorClient(
            baseUrl = "https://your-platform-domain.com",
            tokenProvider = tokenStore,
            actionRegistry = actions,
            navigationRegistry = navigation,
            manifestStore = HelpdeskAndroidManifestStore(context),
        )
    }
}

/**
 * 5) ATTACH IN YOUR ACTIVITY/FRAGMENT — the connector then connects only while
 *    the screen is visible and falls back to safe polling automatically:
 *
 *    class HelpDeskActivity : AppCompatActivity() {
 *        override fun onCreate(savedInstanceState: Bundle?) {
 *            super.onCreate(savedInstanceState)
 *            val connector = HelpdeskQuickStart.setup(
 *                context = this,
 *                products = myProductRepository,
 *                currentStaffRole = { session.currentStaff.role },
 *                openScreen = { route -> navController.navigate(route) },
 *            )
 *            lifecycle.addObserver(
 *                HelpdeskConnectorLifecycleObserver(connector, BuildConfig.VERSION_NAME),
 *            )
 *        }
 *    }
 *
 * That's it. The bot can now search products and (after the user confirms)
 * update a price — all running inside your app against your own data.
 */

/** Replace this with your real product data layer — shown only so the example compiles in your head. */
interface ProductRepository {
    fun search(query: String): List<Product>
    fun updatePrice(productId: String, price: Double)
}

data class Product(val id: String, val name: String, val sku: String, val price: Double)
