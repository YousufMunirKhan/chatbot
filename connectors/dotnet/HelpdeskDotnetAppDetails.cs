/*
 * Fill this file with the CUSTOMER APP'S real details.
 *
 * This is the first file a .NET developer or AI coding agent should edit.
 * Replace the sample screens, route commands, actions, and service interfaces
 * with the real POS/ERP/admin app structure.
 *
 * Keep secrets, database rows, customer lists, payment data, and connector
 * tokens out of this manifest. Only sync software help docs and approved
 * action metadata.
 *
 * The starter manifest is a POS example. Use docs/AUTO_DISCOVERY_PLAYBOOK.md to
 * scan the real menu/forms/routes and replace these samples before production.
 */
static class HelpdeskDotnetAppDetails
{
    public static Manifest BuildManifest(int revision)
    {
        return new Manifest(
            AppVersion: "dotnet-pos-starter-0.3",
            ClientRevision: revision,
            Documents:
            [
                Screen(
                    externalKey: "dashboard.main",
                    module: "Dashboard",
                    screen: "Main Menu",
                    path: "Dashboard > Main Menu",
                    purpose: "Start orders, open management areas, review sync state, and access daily POS operations.",
                    steps: ["Log in as staff.", "Open Dashboard.", "Choose the required menu item."],
                    fields: [new("Current branch", false, "Branch currently selected in the POS.")],
                    commonErrors: ["Staff role may hide manager-only menu items."],
                    actions: ["daily_sales_report"],
                    navigation: DotnetRoute("Open Dashboard", "dashboard.main", "OpenDashboard", "mypos://dashboard")
                ),
                Screen(
                    externalKey: "inventory.products",
                    module: "Inventory",
                    screen: "Products",
                    path: "Inventory > Products",
                    purpose: "Search products, check stock, update sale price, and adjust stock quantity.",
                    steps: ["Open Inventory.", "Open Products.", "Search by name, SKU, barcode, or QR PLU.", "Open the product record."],
                    fields:
                    [
                        new("Search", false, "Product name, SKU, barcode, or QR PLU."),
                        new("Quantity", false, "Current stock quantity."),
                        new("Sale price", false, "Current selling price.")
                    ],
                    commonErrors: ["No products appear when filters are too narrow.", "Only manager/admin roles can update stock or price."],
                    actions: ["search_product", "get_product", "check_stock", "update_product_quantity", "update_product_price"],
                    navigation: DotnetRoute("Open Products", "inventory.products", "OpenProducts", "mypos://inventory/products")
                ),
                Screen(
                    externalKey: "inventory.add_product",
                    module: "Inventory",
                    screen: "Add Product",
                    path: "Inventory > Products > Add Product",
                    purpose: "Create a new product with name, SKU, barcode, sale price, tax, category, and opening stock.",
                    steps: ["Open Inventory.", "Open Products.", "Click Add Product.", "Enter product details.", "Save the product."],
                    fields:
                    [
                        new("Product name", true, "Name shown in search, receipts, and reports."),
                        new("SKU/barcode", false, "Unique SKU or barcode."),
                        new("Sale price", true, "Selling price used at checkout.")
                    ],
                    commonErrors: ["SKU or barcode already exists.", "Price is required before saving."],
                    actions: ["search_product", "create_product"],
                    navigation: DotnetRoute("Open Add Product", "inventory.add_product", "OpenAddProduct", "mypos://inventory/products/new")
                ),
                Screen(
                    externalKey: "orders.list",
                    module: "Orders",
                    screen: "Order List",
                    path: "Orders > Order List",
                    purpose: "Search, review, print, refund, or check payment and fulfilment status for orders.",
                    steps: ["Open Orders.", "Search by order number, customer, date, or status.", "Open an order.", "Review items, totals, payment state, and fulfilment status."],
                    fields:
                    [
                        new("Search", false, "Order number, customer, or receipt reference."),
                        new("Date range", false, "Filter orders by date.")
                    ],
                    commonErrors: ["Offline orders may appear after sync completes.", "Refund actions may require manager approval."],
                    actions: ["search_order", "get_order_status"],
                    navigation: DotnetRoute("Open Orders", "orders.list", "OpenOrders", "mypos://orders")
                ),
                Screen(
                    externalKey: "orders.create",
                    module: "Orders",
                    screen: "Create Order",
                    path: "Orders > New Order",
                    purpose: "Create a POS order by adding products, customer details, discounts, payment, and fulfilment information.",
                    steps: ["Open Orders.", "Choose New Order.", "Add products.", "Attach customer if required.", "Take payment or save the order."],
                    fields:
                    [
                        new("Product search", true, "Products to add to the order."),
                        new("Customer", false, "Optional customer linked to the order.")
                    ],
                    commonErrors: ["Product is out of stock.", "Payment terminal is offline."],
                    actions: ["search_product", "create_order"],
                    navigation: DotnetRoute("Open New Order", "orders.create", "OpenNewOrder", "mypos://orders/new")
                ),
                Screen(
                    externalKey: "customers.list",
                    module: "Customers",
                    screen: "Customer Management",
                    path: "Customers > Customer Management",
                    purpose: "Find, create, or update customer records used for delivery, collection, account sales, and history.",
                    steps: ["Open Customers.", "Search by name, phone, or email.", "Open the customer record.", "Review details, notes, and order history."],
                    fields:
                    [
                        new("Search", false, "Name, phone, email, or customer code."),
                        new("Phone", false, "Customer phone number.")
                    ],
                    commonErrors: ["Duplicate customers may exist with similar phone numbers."],
                    actions: ["search_customer", "create_customer", "update_customer_phone"],
                    navigation: DotnetRoute("Open Customers", "customers.list", "OpenCustomers", "mypos://customers")
                ),
                Screen(
                    externalKey: "purchase_orders.create",
                    module: "Purchase",
                    screen: "Create Purchase Order",
                    path: "Purchase > Purchase Orders > New",
                    purpose: "Create a supplier purchase order with products, quantities, costs, and expected receiving dates.",
                    steps: ["Open Purchase.", "Open Purchase Orders.", "Choose New Purchase Order.", "Select supplier.", "Add products and quantities.", "Save or send the order."],
                    fields:
                    [
                        new("Supplier", true, "Supplier receiving the purchase order."),
                        new("Products", true, "Products and quantities to order.")
                    ],
                    commonErrors: ["Supplier is required.", "Product cost may be missing."],
                    actions: ["create_purchase_order", "search_product"],
                    navigation: DotnetRoute("Open Purchase Order", "purchase_orders.create", "OpenPurchaseOrder", "mypos://purchase/orders/new")
                ),
                Screen(
                    externalKey: "reports.daily_sales",
                    module: "Reports",
                    screen: "Daily Sales",
                    path: "Reports > Daily Sales",
                    purpose: "Review daily sales totals, order count, returns, discounts, cash, and card totals.",
                    steps: ["Open Reports.", "Open Sales.", "Choose Daily Sales.", "Select date and branch.", "Click Generate."],
                    fields:
                    [
                        new("Date", true, "Report date."),
                        new("Branch", false, "Optional branch filter."),
                        new("Cashier", false, "Optional cashier filter.")
                    ],
                    commonErrors: ["Report is empty if no completed sales exist for selected filters."],
                    actions: ["daily_sales_report", "end_of_day_report"],
                    navigation: DotnetRoute("Open Daily Sales", "reports.daily_sales", "OpenDailySalesReport", "mypos://reports/daily-sales")
                ),
                Screen(
                    externalKey: "settings.main",
                    module: "Settings",
                    screen: "Settings",
                    path: "Settings",
                    purpose: "Configure POS, printers, payment terminals, tax, sync, staff, branch, and application settings.",
                    steps: ["Open Settings.", "Choose the setting category.", "Review current values.", "Save changes if permitted."],
                    fields: [new("Setting category", false, "Printer, payment, tax, sync, staff, or branch settings.")],
                    commonErrors: ["Some settings require admin permission.", "Printer/payment settings may require network or device connectivity."],
                    actions: [],
                    navigation: DotnetRoute("Open Settings", "settings.main", "OpenSettings", "mypos://settings")
                )
            ],
            Actions: StandardActions.All.Where(a => new[]
            {
                "search_product",
                "get_product",
                "check_stock",
                "low_stock_products",
                "daily_sales_report",
                "end_of_day_report",
                "update_product_quantity",
                "update_product_price",
                "create_product",
                "search_customer",
                "create_customer",
                "update_customer_phone",
                "search_order",
                "get_order_status",
                "create_order",
                "create_purchase_order"
            }.Contains(a.Name)).ToArray()
        );
    }

    /*
     * Map routeId values to the real WinForms/WPF/navigation commands.
     *
     * Example:
     * - routeId "inventory.products" can call mainForm.ShowProducts()
     * - command "OpenProducts" can map to an existing menu command
     */
    public static bool OpenRoute(string routeId)
    {
        return routeId switch
        {
            "dashboard.main" => RunCommand("OpenDashboard"),
            "inventory.products" => RunCommand("OpenProducts"),
            "inventory.add_product" => RunCommand("OpenAddProduct"),
            "orders.list" => RunCommand("OpenOrders"),
            "orders.create" => RunCommand("OpenNewOrder"),
            "customers.list" => RunCommand("OpenCustomers"),
            "purchase_orders.create" => RunCommand("OpenPurchaseOrder"),
            "reports.daily_sales" => RunCommand("OpenDailySalesReport"),
            "settings.main" => RunCommand("OpenSettings"),
            _ => false
        };
    }

    /*
     * Replace this with the customer's real command/menu/form router.
     */
    private static bool RunCommand(string command)
    {
        Console.WriteLine($"TODO: map Help Desk command to real .NET screen: {command}");
        return false;
    }

    /*
     * Replace these service interfaces with the customer's real repositories.
     * Program.cs still includes starter in-memory handlers for smoke tests.
     */
    public interface IProductService
    {
        object Search(string query);
        object Get(string productId);
        object CheckStock(string productId, string? branchId);
        object UpdateQuantity(string productId, int quantity, string? reason);
        object UpdatePrice(string productId, decimal price, string? reason);
    }

    public interface IReportService
    {
        object DailySales(string date, string? branchId);
        object EndOfDay(string date, string? branchId);
    }

    private static ConnectorDocument Screen(
        string externalKey,
        string module,
        string screen,
        string path,
        string purpose,
        string[] steps,
        ConnectorField[] fields,
        string[] commonErrors,
        string[] actions,
        NavigationTarget navigation)
    {
        return new ConnectorDocument(externalKey, module, screen, path, purpose, steps, fields, commonErrors, actions, navigation);
    }

    private static NavigationTarget DotnetRoute(string label, string routeId, string command, string uri)
    {
        return new NavigationTarget(label, routeId, new { dotnet = new { command, uri } });
    }
}
