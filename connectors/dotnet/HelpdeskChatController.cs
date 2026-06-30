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
        Array.Empty<string>(),
        Array.Empty<string>(),
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
        if (!settings.Enabled || settings.ShowMode == "hidden") return false;
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
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadErrorMessage(body) ?? $"Help Desk chat failed {(int)response.StatusCode}");
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

    private static string? ReadErrorMessage(string body)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            return json.RootElement.TryGetProperty("message", out var message) ? message.GetString() : null;
        }
        catch
        {
            return null;
        }
    }
}
