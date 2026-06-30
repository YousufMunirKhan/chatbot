<?php

/*
|--------------------------------------------------------------------------
| Switch&Save Help Desk Laravel Starter
|--------------------------------------------------------------------------
|
| Copy this file into a Laravel app as:
|   app/Services/Helpdesk/HelpdeskLaravelStarter.php
|
| Then create a connector in Switch&Save Help Desk and set:
|   HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk
|   HELPDESK_CONNECTOR_TOKEN=hdk_your_token
|
| This file is intentionally self-contained so Cursor, Claude, Codex, or a
| developer can replace the sample repositories with real Eloquent/services.
|
*/

namespace App\Services\Helpdesk;

use Illuminate\Support\Facades\Http;

final class HelpdeskLaravelStarter
{
    public function __construct(
        private readonly ProductService $products = new ProductService(),
        private readonly ReportService $reports = new ReportService(),
    ) {
    }

    public function preview(): string
    {
        $manifest = $this->manifest();
        $lines = [
            'Help Desk Laravel Starter',
            '',
            'Screens',
        ];

        foreach ($manifest['documents'] as $doc) {
            $lines[] = "- {$doc['module']} > {$doc['screen']}: {$doc['path']}";
            $lines[] = "  {$doc['purpose']}";
        }

        $lines[] = '';
        $lines[] = 'Actions';
        foreach ($manifest['actions'] as $action) {
            $lines[] = "- {$action['name']} ({$action['type']}/{$action['risk']})";
        }

        return implode(PHP_EOL, $lines);
    }

    public function audit(): array
    {
        $manifest = $this->manifest();
        $blocked = [];
        $warnings = [];
        $routeIds = [];

        foreach ($manifest['documents'] as $doc) {
            if (empty($doc['externalKey'])) $blocked[] = 'A document is missing externalKey.';
            if (empty($doc['purpose'])) $warnings[] = "{$doc['externalKey']} is missing purpose.";
            $routeId = $doc['navigation']['routeId'] ?? null;
            if ($routeId && in_array($routeId, $routeIds, true)) $blocked[] = "Duplicate routeId: {$routeId}";
            if ($routeId) $routeIds[] = $routeId;
        }

        foreach ($manifest['actions'] as $action) {
            $write = in_array($action['type'], ['create', 'update', 'danger'], true) || $action['risk'] !== 'low';
            if ($write && empty($action['needsConfirmation'])) {
                $blocked[] = "{$action['name']} must require confirmation.";
            }
        }

        return ['ok' => count($blocked) === 0, 'blocked' => $blocked, 'warnings' => $warnings];
    }

    public function sync(): array
    {
        $audit = $this->audit();
        if (!$audit['ok']) {
            throw new \RuntimeException('Audit blocked sync: ' . json_encode($audit['blocked']));
        }

        return Http::withToken($this->token())
            ->acceptJson()
            ->post($this->baseUrl() . '/api/helpdesk/connectors/sync', $this->manifest())
            ->throw()
            ->json();
    }

    public function runCycle(): int
    {
        $events = Http::withToken($this->token())
            ->acceptJson()
            ->get($this->baseUrl() . '/api/helpdesk/connectors/events')
            ->throw()
            ->json('events', []);

        foreach ($events as $event) {
            $this->handleEvent($event);
        }

        return count($events);
    }

    public function testRoute(string $routeId): array
    {
        $routes = [
            'dashboard.main' => '/admin',
            'inventory.products' => '/admin/products',
            'reports.daily_sales' => '/admin/reports/daily-sales',
        ];

        return isset($routes[$routeId])
            ? ['ok' => true, 'message' => "Route verified: {$routeId}", 'url' => $routes[$routeId]]
            : ['ok' => false, 'message' => "Route not wired: add {$routeId} to HelpdeskLaravelStarter::manifest()."];
    }

    public function manifest(): array
    {
        return [
            'appVersion' => 'laravel-helpdesk-starter-0.1',
            'clientRevision' => 0,
            'documents' => [
                $this->screen('dashboard.main', 'Dashboard', 'Main Menu', 'Dashboard > Main Menu', 'Start orders, open management areas, and review daily operations.', ['daily_sales_report'], '/admin'),
                $this->screen('inventory.products', 'Inventory', 'Products', 'Dashboard > Inventory > Products', 'Search products, check stock, update sale price, and adjust stock quantity.', ['search_product', 'get_product', 'check_stock', 'update_product_quantity', 'update_product_price'], '/admin/products'),
                $this->screen('reports.daily_sales', 'Reports', 'Daily Sales', 'Dashboard > Reports > Daily Sales', 'Review daily sales totals, order count, cash, and card totals.', ['daily_sales_report', 'end_of_day_report'], '/admin/reports/daily-sales'),
            ],
            'actions' => [
                $this->action('search_product', 'Search products by name, SKU, or barcode.', 'read', 'low', ['query']),
                $this->action('get_product', 'Return one product by id.', 'read', 'low', ['product_id']),
                $this->action('check_stock', 'Return current stock for one product.', 'read', 'low', ['product_id']),
                $this->action('daily_sales_report', 'Return sales summary for a date.', 'report', 'low', ['date']),
                $this->action('end_of_day_report', 'Return end-of-day close summary.', 'report', 'low', ['date']),
                $this->action('update_product_quantity', 'Update stock quantity for one product.', 'update', 'medium', ['product_id', 'quantity'], true),
                $this->action('update_product_price', 'Update product sale price.', 'update', 'medium', ['product_id', 'price'], true),
            ],
        ];
    }

    private function handleEvent(array $event): void
    {
        $started = microtime(true);
        $status = 'completed';
        $response = null;
        $error = null;

        try {
            $response = match ($event['name'] ?? '') {
                'search_product' => ['results' => $this->products->search($event['input']['query'] ?? '')],
                'get_product' => $this->products->get($event['input']['product_id'] ?? ''),
                'check_stock' => $this->products->checkStock($event['input']['product_id'] ?? ''),
                'daily_sales_report' => $this->reports->dailySales($event['input']['date'] ?? date('Y-m-d')),
                'end_of_day_report' => $this->reports->endOfDay($event['input']['date'] ?? date('Y-m-d')),
                default => throw new \RuntimeException('Unsupported action: ' . ($event['name'] ?? 'unknown')),
            };
        } catch (\Throwable $e) {
            $status = 'failed';
            $error = $e->getMessage();
        }

        Http::withToken($this->token())
            ->acceptJson()
            ->post($this->baseUrl() . '/api/helpdesk/connectors/events', [
                'eventId' => $event['id'] ?? '',
                'status' => $status,
                'response' => $response,
                'error' => $error,
                'deliveryMode' => 'polling_fallback',
                'durationMs' => (int) ((microtime(true) - $started) * 1000),
            ])
            ->throw();
    }

    private function screen(string $key, string $module, string $screen, string $path, string $purpose, array $actions, string $url): array
    {
        return [
            'externalKey' => $key,
            'module' => $module,
            'screen' => $screen,
            'path' => $path,
            'purpose' => $purpose,
            'steps' => ['Open admin dashboard.', "Open {$path}.", 'Complete the staff task.'],
            'fields' => [],
            'commonErrors' => [],
            'actions' => $actions,
            'navigation' => ['label' => "Open {$screen}", 'routeId' => $key, 'platformTargets' => ['web' => ['url' => $url]]],
            'needsReview' => false,
        ];
    }

    private function action(string $name, string $description, string $type, string $risk, array $requiredFields, bool $confirmation = false): array
    {
        return [
            'name' => $name,
            'description' => $description,
            'type' => $type,
            'risk' => $risk,
            'requiredFields' => $requiredFields,
            'optionalFields' => [],
            'allowedRoles' => ['admin', 'manager'],
            'needsConfirmation' => $confirmation,
        ];
    }

    private function baseUrl(): string
    {
        return rtrim((string) env('HELPDESK_BASE_URL'), '/');
    }

    private function token(): string
    {
        $token = (string) env('HELPDESK_CONNECTOR_TOKEN');
        if (!str_starts_with($token, 'hdk_')) {
            throw new \RuntimeException('HELPDESK_CONNECTOR_TOKEN must start with hdk_.');
        }
        return $token;
    }
}

final class ProductService
{
    public function search(string $query): array
    {
        return [['id' => 'p_100', 'name' => 'Pepsi 500ml', 'sku' => 'PEP500', 'quantity' => 24]];
    }

    public function get(string $productId): array
    {
        return ['id' => $productId, 'name' => 'Pepsi 500ml', 'sku' => 'PEP500', 'quantity' => 24];
    }

    public function checkStock(string $productId): array
    {
        return ['product_id' => $productId, 'quantity' => 24, 'in_stock' => true];
    }
}

final class ReportService
{
    public function dailySales(string $date): array
    {
        return ['date' => $date, 'gross_sales' => 142500, 'orders' => 87, 'currency' => 'PKR'];
    }

    public function endOfDay(string $date): array
    {
        return ['date' => $date, 'cash' => 78500, 'card' => 64000, 'returns' => 2, 'currency' => 'PKR'];
    }
}
