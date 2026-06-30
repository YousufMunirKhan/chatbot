using System.Text.Json;

public sealed class HelpdeskDefaultChatViewModel
{
    private readonly HelpdeskChatController _controller;

    public HelpdeskDefaultChatViewModel(
        HelpdeskChatController controller,
        string staffName = "Aamir",
        IReadOnlyList<string>? routeIds = null)
    {
        _controller = controller;
        StaffName = staffName;
        RouteIds = routeIds ?? new[]
        {
            "dashboard.main",
            "inventory.products",
            "reports.daily_sales"
        };
    }

    public string StaffName { get; }

    public IReadOnlyList<string> QuickQuestions { get; } = new[]
    {
        "How do I add product?",
        "Check stock",
        "Update product price",
        "Create purchase order",
        "Daily sales report"
    };

    public IReadOnlyList<string> Categories { get; } = new[]
    {
        "For You",
        "Products",
        "Reports",
        "Stock",
        "Customers"
    };

    public IReadOnlyList<string> RouteIds { get; }

    public bool ShouldShow(HelpdeskChatSettings settings)
    {
        return _controller.ShouldShow(settings);
    }

    public async Task<string> AskAsync(string text, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text)) return "Type a staff question first.";

        using JsonDocument response = await _controller.AskAsync(text, cancellationToken);
        if (response.RootElement.TryGetProperty("answer", out var answer)) return answer.GetString() ?? "";
        if (response.RootElement.TryGetProperty("message", out var message)) return message.GetString() ?? "";
        return response.RootElement.ToString();
    }

    public RouteTestResult TestRoute(string routeId)
    {
        if (string.IsNullOrWhiteSpace(routeId))
        {
            return new RouteTestResult(false, "Enter a routeId such as inventory.products.");
        }

        var opened = _controller.OpenRoute(routeId.Trim());
        return opened
            ? new RouteTestResult(true, $"Route verified: {routeId}")
            : new RouteTestResult(false, $"Route not wired: add {routeId} in HelpdeskDotnetAppDetails.cs and map it to a form/window command.");
    }
}

public sealed record RouteTestResult(bool Ok, string Message);
