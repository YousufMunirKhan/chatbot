using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

public sealed record HelpdeskChatSettings(
    bool Enabled,
    string ShowMode,
    string[] AllowedRoles,
    string[] AllowedRoutes,
    string[] BlockedRoutes,
    bool AutoOpen,
    string Position
)
{
    public static HelpdeskChatSettings Default { get; } = new(
        true,
        "floating",
        new[] { "admin", "manager", "staff" },
        new[] { "dashboard", "inventory/*", "purchase/*", "reports/*", "customers/*", "orders/*" },
        new[] { "login", "payment", "checkout", "customer-facing/*", "customer-display/*" },
        false,
        "right"
    );
}

public sealed class HelpdeskChatController
{
    private readonly HttpClient _http;
    private readonly Func<string> _currentRoute;
    private readonly Func<string> _staffRole;
    private readonly Func<string, bool> _openRoute;

    public HelpdeskChatController(HttpClient http, Func<string> currentRoute, Func<string> staffRole, Func<string, bool> openRoute)
    {
        _http = http;
        _currentRoute = currentRoute;
        _staffRole = staffRole;
        _openRoute = openRoute;
    }

    public bool ShouldShow(HelpdeskChatSettings settings)
    {
        var route = Normalize(_currentRoute());
        var role = (_staffRole() ?? "").ToLowerInvariant();
        if (!settings.Enabled || settings.ShowMode == "hidden") return false;
        if (settings.AllowedRoles.Length > 0 && !settings.AllowedRoles.Select(x => x.ToLowerInvariant()).Contains(role)) return false;
        if (string.IsNullOrWhiteSpace(route)) return true;
        if (settings.BlockedRoutes.Any(pattern => RouteMatches(pattern, route))) return false;
        if (settings.AllowedRoutes.Length == 0) return true;
        return settings.AllowedRoutes.Any(pattern => RouteMatches(pattern, route));
    }

    public async Task<JsonDocument> AskAsync(string text, CancellationToken cancellationToken = default)
    {
        var payload = JsonSerializer.Serialize(new
        {
            text,
            currentRoute = _currentRoute(),
            staffRole = _staffRole()
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/helpdesk/chat")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json")
        };
        using var response = await _http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Help Desk chat failed {(int)response.StatusCode}: {body}");
        return JsonDocument.Parse(body);
    }

    public bool OpenRoute(string routeId) => _openRoute(routeId);

    private static string Normalize(string value) => (value ?? "").Trim().Trim('/').ToLowerInvariant();

    private static bool RouteMatches(string pattern, string route)
    {
        var p = Normalize(pattern);
        if (p == "*") return true;
        if (p.EndsWith("/*")) return route == p[..^2] || route.StartsWith(p[..^1]);
        return route == p || route.Contains(p);
    }
}
