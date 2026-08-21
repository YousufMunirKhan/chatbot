/*
 * Connector-owned standard event definitions.
 *
 * Customer apps should map these definitions to their own repositories/services
 * in HelpdeskDotnetAppDetails.cs or separate customer handler classes.
 */
static class StandardHelpdeskEvents
{
    public static readonly ConnectorAction[] All =
    [
        A("search_product", "Search products by name, SKU, or barcode.", "read", "low", ["query"], [], false, ["admin", "manager", "cashier"]),
        A("get_product", "Return one product by id.", "read", "low", ["product_id"], [], false, ["admin", "manager", "cashier"]),
        A("create_product", "Create a product.", "create", "medium", ["name", "price"], ["sku", "barcode", "category_id", "category_name", "opening_stock"], true),
        A("update_product", "Update product fields.", "update", "medium", ["product_id"], ["name", "sku", "barcode", "category_id", "category_name", "price"], true),
        A("update_product_price", "Update product sale price.", "update", "medium", ["product_id", "price"], ["currency", "reason"], true),
        A("update_product_quantity", "Update stock quantity for one product.", "update", "medium", ["product_id", "quantity"], ["branch_id", "reason"], true),
        A("disable_product", "Disable or hide a product.", "update", "high", ["product_id"], ["reason"], true),
        A("check_stock", "Return current stock for one product.", "read", "low", ["product_id"], ["branch_id"], false, ["admin", "manager", "cashier"]),
        A("low_stock_products", "List products at or below stock threshold.", "report", "low", [], ["threshold", "branch_id"]),
        A("stock_adjustment_history", "Return stock adjustment history.", "report", "low", ["product_id"], ["date_from", "date_to"], false),
        A("search_customer", "Search customers by name, phone, or email.", "read", "low", ["query"], [], false),
        A("create_customer", "Create a customer record.", "create", "medium", ["name"], ["phone", "email"], true),
        A("update_customer", "Update customer fields.", "update", "medium", ["customer_id"], ["name", "phone", "email"], true),
        A("update_customer_phone", "Update customer phone number.", "update", "medium", ["customer_id", "phone"], ["reason"], true),
        A("search_order", "Search orders.", "read", "low", ["query"], [], false, ["admin", "manager", "cashier"]),
        A("get_order_status", "Return order status.", "read", "low", ["order_id"], [], false, ["admin", "manager", "cashier"]),
        A("create_order", "Create an order.", "create", "medium", ["items"], ["customer_id", "notes"], true),
        A("cancel_order", "Cancel an order.", "danger", "high", ["order_id"], ["reason"], true),
        A("create_purchase_order", "Create a supplier purchase order.", "create", "medium", ["supplier_id", "items"], ["expected_date", "notes"], true),
        A("search_invoice", "Search invoices.", "read", "low", ["query"], [], false),
        A("get_invoice", "Return invoice summary.", "read", "low", ["invoice_id"], [], false),
        A("daily_sales_report", "Return sales summary for a date.", "report", "low", ["date"], ["branch_id"]),
        A("end_of_day_report", "Return end-of-day close summary.", "report", "low", ["date"], ["branch_id"]),
        A("stock_value_report", "Return stock value summary.", "report", "low", [], ["branch_id"]),
        A("create_support_ticket", "Create an internal support ticket.", "create", "low", ["summary"], ["details"], true, ["admin", "manager", "cashier"]),
        A("add_customer_note", "Add a note to a customer record.", "create", "medium", ["customer_id", "note"], [], true),
    ];

    public static readonly string[] Names = All.Select(action => action.Name).ToArray();

    private static ConnectorAction A(
        string name,
        string description,
        string type,
        string risk,
        string[] required,
        string[] optional,
        bool confirm,
        string[]? roles = null) =>
        new(name, description, type, risk, required, optional, roles ?? ["admin", "manager"], confirm);
}
