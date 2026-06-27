using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var baseUrl = Environment.GetEnvironmentVariable("HELPDESK_BASE_URL")?.TrimEnd('/');
var token = Environment.GetEnvironmentVariable("HELPDESK_CONNECTOR_TOKEN");

if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
{
    Console.WriteLine("Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN before running.");
    return;
}

using var http = new HttpClient();
http.BaseAddress = new Uri(baseUrl);
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

var connector = new HelpdeskConnector(http);

await connector.CheckStatusAsync();

Console.WriteLine("Connector running. Press Ctrl+C to stop.");
while (true)
{
    await connector.PollEventsAsync();
    await Task.Delay(TimeSpan.FromSeconds(5));
}

sealed class HelpdeskConnector
{
    private readonly HttpClient _http;
    private readonly PosActionHandlers _pos = new();
    private int _knownRevision;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public HelpdeskConnector(HttpClient http)
    {
        _http = http;
    }

    public async Task CheckStatusAsync()
    {
        var response = await _http.GetAsync("/api/helpdesk/connectors/status");
        var text = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"Status: {(int)response.StatusCode} {text}");
        response.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(text);
        await HandleSyncCommandAsync(body.RootElement);
    }

    public async Task SyncManifestAsync()
    {
        var payload = new
        {
            appVersion = "dotnet-pos-starter-0.1",
            clientRevision = _knownRevision,
            documents = new object[]
            {
                new
                {
                    externalKey = "inventory.add-product",
                    module = "Inventory",
                    screen = "Add Product",
                    path = "Inventory > Products > Add Product",
                    purpose = "Create a new product in the POS catalogue.",
                    steps = new[]
                    {
                        "Open Inventory.",
                        "Open Products.",
                        "Click Add Product.",
                        "Fill product name, sale price, category, and opening stock.",
                        "Click Save."
                    },
                    fields = new object[]
                    {
                        new { name = "Product name", required = true, description = "Visible product name." },
                        new { name = "Sale price", required = true, description = "Customer selling price." },
                        new { name = "Opening stock", required = false, description = "Initial stock quantity." },
                        new { name = "Barcode", required = false, description = "Unique barcode if used." }
                    },
                    commonErrors = new[]
                    {
                        "Product name is required.",
                        "Sale price cannot be negative.",
                        "Barcode must be unique."
                    },
                    actions = new[] { "search_product", "check_stock", "update_product_quantity" }
                },
                new
                {
                    externalKey = "reports.end-of-day",
                    module = "Reports",
                    screen = "End Of Day Report",
                    path = "Reports > Sales > End Of Day",
                    purpose = "Review sales, cash, card, returns, discounts, and closing totals for a day.",
                    steps = new[]
                    {
                        "Open Reports.",
                        "Open Sales.",
                        "Choose End Of Day.",
                        "Select date, branch, and cashier if needed.",
                        "Click Generate."
                    },
                    fields = new object[]
                    {
                        new { name = "Date", required = true, description = "Report date." },
                        new { name = "Branch", required = false, description = "Branch filter." },
                        new { name = "Cashier", required = false, description = "Cashier filter." }
                    },
                    commonErrors = new[]
                    {
                        "Report is empty if no sales exist for selected filters.",
                        "Only manager or admin roles can view full totals."
                    },
                    actions = new[] { "daily_sales_report", "end_of_day_report" }
                }
            },
            actions = new object[]
            {
                new
                {
                    name = "search_product",
                    description = "Search products by name, SKU, or barcode.",
                    type = "read",
                    risk = "low",
                    requiredFields = new[] { "query" },
                    optionalFields = Array.Empty<string>(),
                    allowedRoles = new[] { "admin", "manager", "cashier" },
                    needsConfirmation = false
                },
                new
                {
                    name = "check_stock",
                    description = "Return current stock for a product.",
                    type = "read",
                    risk = "low",
                    requiredFields = new[] { "product_id" },
                    optionalFields = new[] { "branch_id" },
                    allowedRoles = new[] { "admin", "manager", "cashier" },
                    needsConfirmation = false
                },
                new
                {
                    name = "low_stock_products",
                    description = "List products at or below the stock threshold.",
                    type = "report",
                    risk = "low",
                    requiredFields = Array.Empty<string>(),
                    optionalFields = new[] { "threshold", "branch_id" },
                    allowedRoles = new[] { "admin", "manager" },
                    needsConfirmation = false
                },
                new
                {
                    name = "daily_sales_report",
                    description = "Return sales summary for a date.",
                    type = "report",
                    risk = "low",
                    requiredFields = new[] { "date" },
                    optionalFields = new[] { "branch_id", "cashier_id" },
                    allowedRoles = new[] { "admin", "manager" },
                    needsConfirmation = false
                },
                new
                {
                    name = "end_of_day_report",
                    description = "Return end-of-day close summary.",
                    type = "report",
                    risk = "low",
                    requiredFields = new[] { "date" },
                    optionalFields = new[] { "branch_id", "cashier_id" },
                    allowedRoles = new[] { "admin", "manager" },
                    needsConfirmation = false
                },
                new
                {
                    name = "update_product_quantity",
                    description = "Update stock quantity for one product.",
                    type = "update",
                    risk = "medium",
                    requiredFields = new[] { "product_id", "quantity" },
                    optionalFields = new[] { "branch_id", "reason" },
                    allowedRoles = new[] { "admin", "manager" },
                    needsConfirmation = true
                }
            }
        };

        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var response = await _http.PostAsync(
            "/api/helpdesk/connectors/sync",
            new StringContent(json, Encoding.UTF8, "application/json"));
        var text = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"Sync: {(int)response.StatusCode} {text}");
        response.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(text);
        _knownRevision = ReadInt(body.RootElement, "manifestRevision", _knownRevision);
    }

    public async Task PollEventsAsync()
    {
        var response = await _http.GetAsync("/api/helpdesk/connectors/events");
        response.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        await HandleSyncCommandAsync(body.RootElement);
        foreach (var evt in body.RootElement.GetProperty("events").EnumerateArray())
        {
            var id = evt.GetProperty("id").GetString()!;
            var name = evt.GetProperty("name").GetString()!;
            var input = evt.GetProperty("input");
            Console.WriteLine($"Event: {name} {input}");

            try
            {
                var result = _pos.Execute(name, input);
                await SendEventResultAsync(id, "completed", result, null);
            }
            catch (Exception ex)
            {
                await SendEventResultAsync(id, "failed", null, ex.Message);
            }
        }
    }

    private async Task SendEventResultAsync(string eventId, string status, object? response, string? error)
    {
        var payload = JsonSerializer.Serialize(new { eventId, status, response, error }, JsonOptions);
        var result = await _http.PostAsync(
            "/api/helpdesk/connectors/events",
            new StringContent(payload, Encoding.UTF8, "application/json"));
        result.EnsureSuccessStatusCode();
    }

    private async Task HandleSyncCommandAsync(JsonElement response)
    {
        var serverRevision = ReadInt(response, "manifestRevision", _knownRevision);
        var syncRequired = response.TryGetProperty("syncRequired", out var value) && value.GetBoolean();
        if (syncRequired || serverRevision > _knownRevision)
        {
            await SyncManifestAsync();
            _knownRevision = serverRevision;
        }
    }

    private static int ReadInt(JsonElement input, string key, int fallback)
    {
        if (!input.TryGetProperty(key, out var value)) return fallback;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : int.TryParse(value.ToString(), out var parsed) ? parsed : fallback;
    }
}

sealed class PosActionHandlers
{
    private readonly List<Product> _products =
    [
        new("p_100", "Pepsi 500ml", "PEP500", 120, 24),
        new("p_101", "Water 1.5L", "WAT1500", 90, 4),
        new("p_102", "Chips Salted", "CHP001", 60, 2)
    ];

    public object Execute(string name, JsonElement input)
    {
        return name switch
        {
            "search_product" => SearchProduct(input),
            "check_stock" => CheckStock(input),
            "low_stock_products" => LowStockProducts(input),
            "daily_sales_report" => DailySalesReport(input),
            "end_of_day_report" => EndOfDayReport(input),
            "update_product_quantity" => UpdateProductQuantity(input),
            _ => throw new InvalidOperationException($"Unsupported event: {name}")
        };
    }

    private object SearchProduct(JsonElement input)
    {
        var query = ReadString(input, "query").ToLowerInvariant();
        var matches = _products
            .Where(p => p.Name.ToLowerInvariant().Contains(query) || p.Sku.ToLowerInvariant().Contains(query))
            .Take(10)
            .ToArray();
        return new { results = matches };
    }

    private object CheckStock(JsonElement input)
    {
        var productId = ReadString(input, "product_id");
        var product = _products.FirstOrDefault(p => p.Id == productId)
            ?? throw new InvalidOperationException("Product not found.");
        return new { product.Id, product.Name, product.Quantity, in_stock = product.Quantity > 0 };
    }

    private object LowStockProducts(JsonElement input)
    {
        var threshold = ReadInt(input, "threshold", 5);
        return new { threshold, results = _products.Where(p => p.Quantity <= threshold).ToArray() };
    }

    private static object DailySalesReport(JsonElement input)
    {
        var date = ReadString(input, "date", DateTime.UtcNow.ToString("yyyy-MM-dd"));
        return new { date, gross_sales = 142500, orders = 87, returns = 2, currency = "PKR" };
    }

    private static object EndOfDayReport(JsonElement input)
    {
        var date = ReadString(input, "date", DateTime.UtcNow.ToString("yyyy-MM-dd"));
        return new
        {
            date,
            cash = 78500,
            card = 64000,
            discounts = 3500,
            returns = 2,
            open_orders = 3,
            currency = "PKR"
        };
    }

    private object UpdateProductQuantity(JsonElement input)
    {
        var productId = ReadString(input, "product_id");
        var quantity = ReadInt(input, "quantity", -1);
        if (quantity < 0) throw new InvalidOperationException("Quantity must be zero or higher.");
        var index = _products.FindIndex(p => p.Id == productId);
        if (index < 0) throw new InvalidOperationException("Product not found.");
        var old = _products[index];
        _products[index] = old with { Quantity = quantity };
        return new { old.Id, old.Name, previous_quantity = old.Quantity, next_quantity = quantity };
    }

    private static string ReadString(JsonElement input, string key, string fallback = "")
    {
        return input.TryGetProperty(key, out var value) ? value.ToString() : fallback;
    }

    private static int ReadInt(JsonElement input, string key, int fallback)
    {
        if (!input.TryGetProperty(key, out var value)) return fallback;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : int.TryParse(value.ToString(), out var parsed) ? parsed : fallback;
    }
}

record Product(string Id, string Name, string Sku, decimal Price, int Quantity);
