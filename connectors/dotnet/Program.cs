using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

var baseUrl = Environment.GetEnvironmentVariable("HELPDESK_BASE_URL")?.TrimEnd('/');
var wsBaseUrl = Environment.GetEnvironmentVariable("HELPDESK_WS_BASE_URL")?.TrimEnd('/');
var token = Environment.GetEnvironmentVariable("HELPDESK_CONNECTOR_TOKEN");

if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
{
    Console.WriteLine("Set HELPDESK_BASE_URL and HELPDESK_CONNECTOR_TOKEN before running.");
    Console.WriteLine("Create a connector in Switch&Save Help Desk, copy the hdk_ token, then set:");
    Console.WriteLine(@"  $env:HELPDESK_BASE_URL=""https://chatbot.ssepos.co.uk""");
    Console.WriteLine(@"  $env:HELPDESK_CONNECTOR_TOKEN=""hdk_your_token_from_help_desk""");
    return;
}

if (!token.StartsWith("hdk_", StringComparison.Ordinal))
{
    Console.WriteLine("HELPDESK_CONNECTOR_TOKEN must start with hdk_. Copy it from Company -> Internal Help Desk -> Create connector.");
    return;
}

using var http = new HttpClient();
http.BaseAddress = new Uri(baseUrl);
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

var connector = new HelpdeskConnector(http, baseUrl, wsBaseUrl ?? baseUrl, token);
Console.WriteLine(connector.PreviewManifest());
var audit = connector.AuditManifest();
Console.WriteLine(audit.ToConsoleText());
if (!audit.Ok)
{
    Console.WriteLine("Fix blocked audit issues before syncing.");
    return;
}

await connector.CheckStatusAsync();
await connector.TryWebSocketThenFallbackAsync();

sealed class HelpdeskConnector
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _wsBaseUrl;
    private readonly string _token;
    private readonly PosActionHandlers _pos = new();
    private int _knownRevision;
    private int _pollIntervalSeconds = 60;
    private const string PollingMode = "polling_fallback";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public HelpdeskConnector(HttpClient http, string baseUrl, string wsBaseUrl, string token)
    {
        _http = http;
        _baseUrl = baseUrl;
        _wsBaseUrl = wsBaseUrl;
        _token = token;
    }

    public string PreviewManifest()
    {
        var manifest = BuildManifest();
        var lines = new List<string>
        {
            $"App version: {manifest.AppVersion}",
            $"Documents: {manifest.Documents.Length}",
            $"Actions: {manifest.Actions.Length}",
            "",
            "Screens"
        };
        lines.AddRange(manifest.Documents.Select(d =>
            $"- {d.Module} > {d.Screen}: {d.Path} [{d.Navigation?.RouteId ?? "no route"}]"));
        lines.Add("");
        lines.Add("Actions");
        lines.AddRange(manifest.Actions.Select(a =>
            $"- {a.Name} ({a.Type}/{a.Risk}) {(_pos.Supports(a.Name) ? "connected" : "missing handler")}"));
        return string.Join(Environment.NewLine, lines);
    }

    public ConnectorAudit AuditManifest()
    {
        var manifest = BuildManifest();
        var blocked = new List<string>();
        var warnings = new List<string>();
        var keys = new HashSet<string>();
        var actions = new HashSet<string>();
        var routes = new HashSet<string>();

        foreach (var doc in manifest.Documents)
        {
            if (string.IsNullOrWhiteSpace(doc.ExternalKey)) blocked.Add("A document is missing externalKey.");
            if (!keys.Add(doc.ExternalKey)) blocked.Add($"Duplicate document key: {doc.ExternalKey}");
            if (string.IsNullOrWhiteSpace(doc.Path) || string.IsNullOrWhiteSpace(doc.Purpose)) warnings.Add($"{doc.ExternalKey} is missing path or purpose.");
            if (doc.Steps.Length < 2) warnings.Add($"{doc.ExternalKey} has short steps.");
            if (doc.Navigation?.RouteId is { Length: > 0 } route && !routes.Add(route)) blocked.Add($"Duplicate routeId: {route}");
            var text = JsonSerializer.Serialize(doc).ToLowerInvariant();
            if (new[] { "api_key", "password", "secret", "token", "connection string", "private key", "cvv", "card number" }.Any(text.Contains))
            {
                blocked.Add($"{doc.ExternalKey} may contain a secret or payment field.");
            }
        }

        foreach (var action in manifest.Actions)
        {
            if (!actions.Add(action.Name)) blocked.Add($"Duplicate action: {action.Name}");
            if (!_pos.Supports(action.Name)) warnings.Add($"{action.Name} has no local handler connected.");
            var risky = action.Type is "create" or "update" or "danger" || action.Risk != "low";
            if (risky && !action.NeedsConfirmation) blocked.Add($"{action.Name} must require confirmation.");
            if (action.Type == "danger") blocked.Add($"{action.Name} is dangerous and should stay disabled in V1.");
        }

        return new ConnectorAudit(blocked.Count == 0, blocked, warnings);
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

    public async Task TryWebSocketThenFallbackAsync()
    {
        try
        {
            await ReportHealthAsync("websocket_reconnect_attempt", "info", "Trying connector WebSocket.");
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("Authorization", $"Bearer {_token}");
            var wsUrl = ToWebSocketUri(_wsBaseUrl, "/api/helpdesk/connectors/socket");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await socket.ConnectAsync(wsUrl, timeout.Token);
            await ReportHealthAsync("websocket_connected", "success", "WebSocket connected.");
            await ReceiveWebSocketLoopAsync(socket, timeout.Token);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WebSocket unavailable, using polling fallback: {ex.Message}");
            await ReportHealthAsync("websocket_reconnect_failed", "warning", ex.Message);
            await ReportHealthAsync("fallback_started", "warning", "WebSocket unavailable; using safe polling fallback.");
            await RunPollingFallbackAsync();
        }
    }

    private async Task ReceiveWebSocketLoopAsync(ClientWebSocket socket, CancellationToken token)
    {
        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, token);
            if (result.MessageType == WebSocketMessageType.Close) break;
            var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("event", out var evt))
            {
                await ExecuteEventAsync(evt);
            }
        }
        await ReportHealthAsync("websocket_disconnected", "warning", "WebSocket disconnected.");
    }

    private async Task RunPollingFallbackAsync()
    {
        Console.WriteLine("Connector running in safe polling fallback. Press Ctrl+C to stop.");
        while (true)
        {
            try
            {
                await PollEventsAsync();
                await Task.Delay(TimeSpan.FromSeconds(_pollIntervalSeconds));
            }
            catch (Exception ex)
            {
                await ReportHealthAsync("poll_failed", "error", ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(_pollIntervalSeconds * 2, 300)));
            }
        }
    }

    public async Task SyncManifestAsync()
    {
        var audit = AuditManifest();
        if (!audit.Ok)
        {
            await ReportHealthAsync("sync_failed", "error", "Manifest audit failed.");
            throw new InvalidOperationException("Manifest audit failed.");
        }

        var payload = JsonSerializer.Serialize(BuildManifest(), JsonOptions);
        var response = await _http.PostAsync(
            "/api/helpdesk/connectors/sync",
            new StringContent(payload, Encoding.UTF8, "application/json"));
        var text = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"Sync: {(int)response.StatusCode} {text}");
        response.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(text);
        _knownRevision = ReadInt(body.RootElement, "manifestRevision", _knownRevision);
    }

    public async Task PollEventsAsync()
    {
        var started = Environment.TickCount64;
        await ReportHealthAsync("poll_attempt", "info", null);
        var response = await _http.GetAsync("/api/helpdesk/connectors/events");
        response.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        await HandleSyncCommandAsync(body.RootElement);
        var events = body.RootElement.GetProperty("events").EnumerateArray().ToArray();
        foreach (var evt in events) await ExecuteEventAsync(evt);
        await ReportHealthAsync("poll_success", "success", null, eventsReturned: events.Length, durationMs: (int)(Environment.TickCount64 - started));
    }

    private async Task ExecuteEventAsync(JsonElement evt)
    {
        var id = evt.GetProperty("id").GetString()!;
        var name = evt.GetProperty("name").GetString()!;
        var input = evt.GetProperty("input");
        Console.WriteLine($"Event: {name} {input}");
        var started = Environment.TickCount64;

        try
        {
            var result = _pos.Execute(name, input);
            await SendEventResultAsync(id, "completed", result, null, (int)(Environment.TickCount64 - started));
        }
        catch (Exception ex)
        {
            if (!_pos.Supports(name)) await ReportHealthAsync("handler_missing", "error", ex.Message, eventId: id, actionName: name);
            await SendEventResultAsync(id, "failed", null, ex.Message, (int)(Environment.TickCount64 - started));
        }
    }

    private async Task SendEventResultAsync(string eventId, string status, object? response, string? error, int durationMs)
    {
        var payload = JsonSerializer.Serialize(new { eventId, status, response, error, deliveryMode = PollingMode, durationMs }, JsonOptions);
        var result = await _http.PostAsync(
            "/api/helpdesk/connectors/events",
            new StringContent(payload, Encoding.UTF8, "application/json"));
        result.EnsureSuccessStatusCode();
    }

    private async Task ReportHealthAsync(string eventType, string status, string? message, string? eventId = null, string? actionName = null, int? eventsReturned = null, int? durationMs = null)
    {
        var payload = JsonSerializer.Serialize(new
        {
            eventType,
            status,
            message,
            eventId,
            actionName,
            deliveryMode = PollingMode,
            pollIntervalSeconds = _pollIntervalSeconds,
            eventsReturned,
            durationMs,
            metadata = new { app = "dotnet-pos-starter" }
        }, JsonOptions);
        var response = await _http.PostAsync("/api/helpdesk/connectors/health", new StringContent(payload, Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();
    }

    private async Task HandleSyncCommandAsync(JsonElement response)
    {
        var serverRevision = ReadInt(response, "manifestRevision", _knownRevision);
        var syncRequired = response.TryGetProperty("syncRequired", out var value) && value.GetBoolean();
        if (response.TryGetProperty("delivery", out var delivery))
        {
            _pollIntervalSeconds = ReadInt(delivery, "pollIntervalSeconds", _pollIntervalSeconds);
        }
        if (syncRequired || serverRevision > _knownRevision)
        {
            await SyncManifestAsync();
            _knownRevision = serverRevision;
        }
    }

    private Manifest BuildManifest() => HelpdeskDotnetAppDetails.BuildManifest(_knownRevision);

    private static Uri ToWebSocketUri(string baseUrl, string path)
    {
        var uri = new Uri(baseUrl);
        var scheme = uri.Scheme == "https" ? "wss" : "ws";
        return new Uri($"{scheme}://{uri.Authority}{path}");
    }

    private static int ReadInt(JsonElement input, string key, int fallback)
    {
        if (!input.TryGetProperty(key, out var value)) return fallback;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : int.TryParse(value.ToString(), out var parsed) ? parsed : fallback;
    }
}

static class ManifestFactory
{
    public static Manifest Build(int revision) => new(
        AppVersion: "dotnet-pos-starter-0.2",
        ClientRevision: revision,
        Documents:
        [
            new ConnectorDocument(
                "inventory.add_product",
                "Inventory",
                "Add Product",
                "Inventory > Products > Add Product",
                "Create a new product in the POS catalogue.",
                ["Open Inventory.", "Open Products.", "Click Add Product.", "Fill product name, sale price, category, and opening stock.", "Click Save."],
                [new("Product name", true, "Visible product name."), new("Sale price", true, "Customer selling price."), new("Opening stock", false, "Initial stock quantity."), new("Barcode", false, "Unique barcode if used.")],
                ["Product name is required.", "Sale price cannot be negative.", "Barcode must be unique."],
                ["search_product", "create_product", "update_product_price", "update_product_quantity"],
                new NavigationTarget("Open Add Product", "inventory.add_product", new { dotnet = new { command = "OpenAddProductScreen", uri = "mypos://inventory/products/new" } })
            ),
            new ConnectorDocument(
                "reports.end_of_day",
                "Reports",
                "End Of Day Report",
                "Reports > Sales > End Of Day",
                "Review sales, cash, card, returns, discounts, and closing totals for a day.",
                ["Open Reports.", "Open Sales.", "Choose End Of Day.", "Select date, branch, and cashier if needed.", "Click Generate."],
                [new("Date", true, "Report date."), new("Branch", false, "Branch filter."), new("Cashier", false, "Cashier filter.")],
                ["Report is empty if no sales exist for selected filters.", "Only manager or admin roles can view full totals."],
                ["daily_sales_report", "end_of_day_report"],
                new NavigationTarget("Open End Of Day", "reports.end_of_day", new { dotnet = new { command = "OpenEndOfDayReport", uri = "mypos://reports/end-of-day" } })
            )
        ],
        Actions: StandardActions.All.Where(a => new[]
        {
            "search_product", "get_product", "check_stock", "low_stock_products", "daily_sales_report",
            "end_of_day_report", "update_product_quantity", "update_product_price", "create_product"
        }.Contains(a.Name)).ToArray()
    );
}

static class StandardActions
{
    public static readonly ConnectorAction[] All =
    [
        A("search_product", "Search products by name, SKU, or barcode.", "read", "low", ["query"], [], false, ["admin", "manager", "cashier"]),
        A("get_product", "Return one product by id.", "read", "low", ["product_id"], [], false, ["admin", "manager", "cashier"]),
        A("create_product", "Create a product.", "create", "medium", ["name", "price"], ["sku", "barcode", "opening_stock"], true),
        A("update_product", "Update product fields.", "update", "medium", ["product_id"], ["name", "sku", "barcode", "category"], true),
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
        A("create_order", "Create an order.", "create", "medium", ["customer_id", "items"], ["notes"], true),
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

    private static ConnectorAction A(string name, string description, string type, string risk, string[] required, string[] optional, bool confirm, string[]? roles = null) =>
        new(name, description, type, risk, required, optional, roles ?? ["admin", "manager"], confirm);
}

sealed class PosActionHandlers
{
    private readonly List<Product> _products =
    [
        new("p_100", "Pepsi 500ml", "PEP500", 120, 24),
        new("p_101", "Water 1.5L", "WAT1500", 90, 4),
        new("p_102", "Chips Salted", "CHP001", 60, 2)
    ];

    public bool Supports(string name) => name switch
    {
        "search_product" or "get_product" or "check_stock" or "low_stock_products" or
        "daily_sales_report" or "end_of_day_report" or "update_product_quantity" or
        "update_product_price" => true,
        _ => false
    };

    public object Execute(string name, JsonElement input) => name switch
    {
        "search_product" => SearchProduct(input),
        "get_product" => GetProduct(input),
        "check_stock" => CheckStock(input),
        "low_stock_products" => LowStockProducts(input),
        "daily_sales_report" => DailySalesReport(input),
        "end_of_day_report" => EndOfDayReport(input),
        "update_product_quantity" => UpdateProductQuantity(input),
        "update_product_price" => UpdateProductPrice(input),
        _ => throw new InvalidOperationException($"Unsupported event: {name}")
    };

    private object SearchProduct(JsonElement input)
    {
        var query = ReadString(input, "query").ToLowerInvariant();
        var matches = _products
            .Where(p => p.Name.ToLowerInvariant().Contains(query) || p.Sku.ToLowerInvariant().Contains(query))
            .Take(10)
            .ToArray();
        return new { results = matches };
    }

    private object GetProduct(JsonElement input)
    {
        var productId = ReadString(input, "product_id");
        var product = _products.FirstOrDefault(p => p.Id == productId)
            ?? throw new InvalidOperationException("Product not found.");
        return product;
    }

    private object CheckStock(JsonElement input)
    {
        var product = (Product)GetProduct(input);
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
        return new { date, cash = 78500, card = 64000, discounts = 3500, returns = 2, open_orders = 3, currency = "PKR" };
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

    private object UpdateProductPrice(JsonElement input)
    {
        var productId = ReadString(input, "product_id");
        var price = ReadDecimal(input, "price", -1);
        if (price < 0) throw new InvalidOperationException("Price must be zero or higher.");
        var index = _products.FindIndex(p => p.Id == productId);
        if (index < 0) throw new InvalidOperationException("Product not found.");
        var old = _products[index];
        _products[index] = old with { Price = price };
        return new { old.Id, old.Name, previous_price = old.Price, next_price = price };
    }

    private static string ReadString(JsonElement input, string key, string fallback = "") =>
        input.TryGetProperty(key, out var value) ? value.ToString() : fallback;

    private static int ReadInt(JsonElement input, string key, int fallback) =>
        input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : input.TryGetProperty(key, out value) && int.TryParse(value.ToString(), out var parsed) ? parsed : fallback;

    private static decimal ReadDecimal(JsonElement input, string key, decimal fallback) =>
        input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)
            ? number
            : input.TryGetProperty(key, out value) && decimal.TryParse(value.ToString(), out var parsed) ? parsed : fallback;
}

record ConnectorAudit(bool Ok, List<string> Blocked, List<string> Warnings)
{
    public string ToConsoleText() => string.Join(Environment.NewLine, new[]
    {
        $"Audit: {(Ok ? "passed" : "blocked")}",
        "Warnings:",
        Warnings.Count == 0 ? "- none" : string.Join(Environment.NewLine, Warnings.Select(x => "- " + x)),
        "Blocked:",
        Blocked.Count == 0 ? "- none" : string.Join(Environment.NewLine, Blocked.Select(x => "- " + x))
    });
}

record Manifest(string AppVersion, int ClientRevision, ConnectorDocument[] Documents, ConnectorAction[] Actions);
record ConnectorDocument(string ExternalKey, string Module, string Screen, string Path, string Purpose, string[] Steps, ConnectorField[] Fields, string[] CommonErrors, string[] Actions, NavigationTarget? Navigation);
record ConnectorField(string Name, bool Required, string? Description = null);
record NavigationTarget(string Label, string RouteId, object PlatformTargets);
record ConnectorAction(string Name, string Description, string Type, string Risk, string[] RequiredFields, string[] OptionalFields, string[] AllowedRoles, bool NeedsConfirmation);
record Product(string Id, string Name, string Sku, decimal Price, int Quantity);
