# Laravel AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating a Laravel app, Laravel POS backend, admin panel, or Inertia/Livewire dashboard.

## What To Inspect

Ask the developer to provide:

- `routes/web.php` and `routes/api.php`
- controllers for products, stock, purchase orders, invoices, customers, reports
- policies/gates/middleware
- FormRequest validation classes
- Eloquent models and service classes
- Blade/Livewire/Inertia/Vue/React admin screens
- queue configuration
- navigation/sidebar/menu files

## Recommended Structure

```text
app/Services/Helpdesk/HelpdeskConnector.php
app/Services/Helpdesk/HelpdeskManifest.php
app/Services/Helpdesk/HelpdeskActions.php
app/Services/Helpdesk/HelpdeskNavigation.php
app/Console/Commands/HelpdeskSync.php
app/Jobs/HelpdeskPollEvents.php
config/helpdesk.php
resources/views/helpdesk/chat.blade.php
```

## Config

```php
return [
    'base_url' => env('HELPDESK_BASE_URL'),
    'token' => env('HELPDESK_CONNECTOR_TOKEN'),
    'poll_interval_seconds' => env('HELPDESK_POLL_INTERVAL', 60),
];
```

## Navigation Registry

```php
final class HelpdeskNavigation
{
    public static function targets(): array
    {
        return [
            'purchase_orders.create' => [
                'label' => 'Open Create Purchase Order',
                'url' => route('purchase-orders.create'),
            ],
        ];
    }
}
```

## Action Registry

```php
final class HelpdeskActions
{
    public function run(string $name, array $input, User $user): array
    {
        return match ($name) {
            'search_product' => $this->searchProduct($input, $user),
            'update_product_price' => $this->updateProductPrice($input, $user),
            default => throw new InvalidArgumentException("Unsupported action {$name}"),
        };
    }

    private function updateProductPrice(array $input, User $user): array
    {
        Gate::forUser($user)->authorize('update-products');
        if (($input['confirmed'] ?? false) !== true) {
            throw new RuntimeException('Confirmation required.');
        }

        $product = Product::query()->findOrFail($input['product_id']);
        $product->update(['price' => $input['price']]);

        return [
            'success' => true,
            'product_id' => $product->id,
            'price' => $product->price,
        ];
    }
}
```

## Worker

Use Laravel scheduler or queue:

```php
Schedule::job(new HelpdeskPollEvents)->everyMinute();
```

The job should:

1. call `/api/helpdesk/connectors/status`
2. sync manifest when required
3. poll events
4. run local handlers
5. post result

## Embedded Staff Chat

Use the staff-only endpoint through your backend. Do not expose the connector token in public JavaScript.

```php
Route::post('/admin/helpdesk/chat', function (Request $request) {
    abort_unless($request->user()->can('use-helpdesk'), 403);

    return Http::withToken(config('helpdesk.token'))
        ->post(config('helpdesk.base_url').'/api/helpdesk/chat', [
            'text' => $request->input('text'),
            'currentRoute' => $request->input('currentRoute'),
            'staffRole' => $request->user()->role,
        ])
        ->json();
});
```

## Safety

- Use Laravel Gates/Policies before write actions.
- Use FormRequest-style validation before updates.
- Never run raw SQL from LLM output.
- Return small JSON summaries only.
