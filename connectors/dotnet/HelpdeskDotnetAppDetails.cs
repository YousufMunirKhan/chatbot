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
                "update_product_price"
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
            "reports.daily_sales" => RunCommand("OpenDailySalesReport"),
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
