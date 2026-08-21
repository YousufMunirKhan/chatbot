<?php

namespace App\Services\Helpdesk;

/*
|--------------------------------------------------------------------------
| Connector-owned standard event definitions
|--------------------------------------------------------------------------
|
| Customer apps should map these event definitions to their own Eloquent
| models, repositories, or services. Do not place customer business logic here.
|
*/

final class StandardHelpdeskEvents
{
    public static function all(): array
    {
        return [
            self::event('search_product', 'Search products by name, SKU, or barcode.', 'read', 'low', ['query'], [], false, ['admin', 'manager', 'cashier']),
            self::event('get_product', 'Return one product by id.', 'read', 'low', ['product_id'], [], false, ['admin', 'manager', 'cashier']),
            self::event('create_product', 'Create a product.', 'create', 'medium', ['name', 'price'], ['sku', 'barcode', 'category_id', 'category_name', 'opening_stock'], true),
            self::event('update_product', 'Update product fields.', 'update', 'medium', ['product_id'], ['name', 'sku', 'barcode', 'category_id', 'category_name', 'price'], true),
            self::event('update_product_price', 'Update product sale price.', 'update', 'medium', ['product_id', 'price'], ['currency', 'reason'], true),
            self::event('update_product_quantity', 'Update stock quantity for one product.', 'update', 'medium', ['product_id', 'quantity'], ['branch_id', 'reason'], true),
            self::event('disable_product', 'Disable or hide a product.', 'update', 'high', ['product_id'], ['reason'], true, ['admin', 'manager'], false),
            self::event('check_stock', 'Return current stock for one product.', 'read', 'low', ['product_id'], ['branch_id'], false, ['admin', 'manager', 'cashier']),
            self::event('low_stock_products', 'List products at or below stock threshold.', 'report', 'low', [], ['threshold', 'branch_id']),
            self::event('stock_adjustment_history', 'Return stock adjustment history.', 'report', 'low', ['product_id'], ['date_from', 'date_to']),
            self::event('search_customer', 'Search customers by name, phone, or email.', 'read', 'low', ['query']),
            self::event('create_customer', 'Create a customer record.', 'create', 'medium', ['name'], ['phone', 'email'], true),
            self::event('update_customer', 'Update customer fields.', 'update', 'medium', ['customer_id'], ['name', 'phone', 'email'], true),
            self::event('update_customer_phone', 'Update customer phone number.', 'update', 'medium', ['customer_id', 'phone'], ['reason'], true),
            self::event('search_order', 'Search orders.', 'read', 'low', ['query'], [], false, ['admin', 'manager', 'cashier']),
            self::event('get_order_status', 'Return order status.', 'read', 'low', ['order_id'], [], false, ['admin', 'manager', 'cashier']),
            self::event('create_order', 'Create an order.', 'create', 'medium', ['items'], ['customer_id', 'notes'], true),
            self::event('cancel_order', 'Cancel an order.', 'danger', 'high', ['order_id'], ['reason'], true, ['admin', 'manager'], false),
            self::event('create_purchase_order', 'Create a supplier purchase order.', 'create', 'medium', ['supplier_id', 'items'], ['expected_date', 'notes'], true),
            self::event('search_invoice', 'Search invoices.', 'read', 'low', ['query']),
            self::event('get_invoice', 'Return invoice summary.', 'read', 'low', ['invoice_id']),
            self::event('daily_sales_report', 'Return sales summary for a date.', 'report', 'low', ['date'], ['branch_id']),
            self::event('end_of_day_report', 'Return end-of-day close summary.', 'report', 'low', ['date'], ['branch_id']),
            self::event('stock_value_report', 'Return stock value summary.', 'report', 'low', [], ['branch_id']),
            self::event('create_support_ticket', 'Create an internal support ticket.', 'create', 'low', ['summary'], ['details'], true, ['admin', 'manager', 'cashier']),
            self::event('add_customer_note', 'Add a note to a customer record.', 'create', 'medium', ['customer_id', 'note'], [], true),
        ];
    }

    public static function names(): array
    {
        return array_map(fn (array $event) => $event['name'], self::all());
    }

    private static function event(
        string $name,
        string $description,
        string $type,
        string $risk,
        array $requiredFields,
        array $optionalFields = [],
        bool $needsConfirmation = false,
        array $allowedRoles = ['admin', 'manager'],
        bool $enabled = true
    ): array {
        return [
            'name' => $name,
            'description' => $description,
            'type' => $type,
            'risk' => $risk,
            'requiredFields' => $requiredFields,
            'optionalFields' => $optionalFields,
            'allowedRoles' => $allowedRoles,
            'needsConfirmation' => $needsConfirmation,
            'enabled' => $enabled,
        ];
    }
}
