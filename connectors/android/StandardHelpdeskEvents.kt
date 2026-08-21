package com.switchsave.helpdesk

/**
 * Connector-owned standard event definitions.
 *
 * Customer apps should map these definitions to their own repositories/services
 * in HelpdeskAndroidAppDetails.kt or separate customer handler files.
 */
object StandardHelpdeskEvents {
    fun all(): List<HelpdeskActionDefinition> = listOf(
        action("search_product", "Search products by name, SKU, or barcode.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager", "cashier")),
        action("get_product", "Return one product by id.", "read", "low", listOf("product_id"), allowedRoles = listOf("admin", "manager", "cashier")),
        action("create_product", "Create a product.", "create", "medium", listOf("name", "price"), listOf("sku", "barcode", "category_id", "category_name", "opening_stock"), true),
        action("update_product", "Update product fields.", "update", "medium", listOf("product_id"), listOf("name", "sku", "barcode", "category_id", "category_name", "price"), true),
        action("update_product_price", "Update product sale price.", "update", "medium", listOf("product_id", "price"), listOf("currency", "reason"), true),
        action("update_product_quantity", "Update stock quantity for one product.", "update", "medium", listOf("product_id", "quantity"), listOf("branch_id", "reason"), true),
        action("disable_product", "Disable or hide a product.", "update", "high", listOf("product_id"), listOf("reason"), true, enabled = false),
        action("check_stock", "Return current stock for one product.", "read", "low", listOf("product_id"), listOf("branch_id"), allowedRoles = listOf("admin", "manager", "cashier")),
        action("low_stock_products", "List products at or below stock threshold.", "report", "low", optionalFields = listOf("threshold", "branch_id")),
        action("stock_adjustment_history", "Return stock adjustment history.", "report", "low", listOf("product_id"), listOf("date_from", "date_to")),
        action("search_customer", "Search customers by name, phone, or email.", "read", "low", listOf("query")),
        action("create_customer", "Create a customer record.", "create", "medium", listOf("name"), listOf("phone", "email"), true),
        action("update_customer", "Update customer fields.", "update", "medium", listOf("customer_id"), listOf("name", "phone", "email"), true),
        action("update_customer_phone", "Update customer phone number.", "update", "medium", listOf("customer_id", "phone"), listOf("reason"), true),
        action("search_order", "Search orders.", "read", "low", listOf("query"), allowedRoles = listOf("admin", "manager", "cashier")),
        action("get_order_status", "Return order status.", "read", "low", listOf("order_id"), allowedRoles = listOf("admin", "manager", "cashier")),
        action("create_order", "Create an order.", "create", "medium", listOf("items"), listOf("customer_id", "notes"), true),
        action("cancel_order", "Cancel an order.", "danger", "high", listOf("order_id"), listOf("reason"), true, enabled = false),
        action("create_purchase_order", "Create a supplier purchase order.", "create", "medium", listOf("supplier_id", "items"), listOf("expected_date", "notes"), true),
        action("search_invoice", "Search invoices.", "read", "low", listOf("query")),
        action("get_invoice", "Return invoice summary.", "read", "low", listOf("invoice_id")),
        action("daily_sales_report", "Return sales summary for a date.", "report", "low", listOf("date"), listOf("branch_id")),
        action("end_of_day_report", "Return end-of-day close summary.", "report", "low", listOf("date"), listOf("branch_id")),
        action("stock_value_report", "Return stock value summary.", "report", "low", optionalFields = listOf("branch_id")),
        action("create_support_ticket", "Create an internal support ticket.", "create", "low", listOf("summary"), listOf("details"), true, listOf("admin", "manager", "cashier")),
        action("add_customer_note", "Add a note to a customer record.", "create", "medium", listOf("customer_id", "note"), needsConfirmation = true)
    )

    fun names(): List<String> = all().map { it.name }

    private fun action(
        name: String,
        description: String,
        type: String,
        risk: String,
        requiredFields: List<String> = emptyList(),
        optionalFields: List<String> = emptyList(),
        needsConfirmation: Boolean = false,
        allowedRoles: List<String> = listOf("admin", "manager"),
        enabled: Boolean = true
    ): HelpdeskActionDefinition {
        return HelpdeskActionDefinition(
            name = name,
            description = description,
            type = type,
            risk = risk,
            requiredFields = requiredFields,
            optionalFields = optionalFields,
            allowedRoles = allowedRoles,
            needsConfirmation = needsConfirmation,
            enabled = enabled
        )
    }
}
