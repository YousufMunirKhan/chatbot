# Custom API Integration

Use this when a customer has a POS, ERP, CRM, mobile app, or custom website that can expose product/order/customer data over HTTP.

## Connection Fields

In `/company/integrations`, choose `Custom API` and provide:

```text
Base URL: https://api.client.com
Token: optional bearer token
Products path: /products
Inventory path: /inventory
Orders path: /orders
Customers path: /customers
```

All paths are optional except products. If a path is blank, that entity is skipped.

## Authentication

If a token is provided, the platform sends:

```text
Authorization: Bearer YOUR_TOKEN
```

## Response Shape

Each endpoint can return either a direct array:

```json
[
  { "id": "prod_100", "title": "Retail EPOS", "price": 499 }
]
```

or an object with the matching root key:

```json
{
  "products": [
    { "id": "prod_100", "title": "Retail EPOS", "price": 499 }
  ]
}
```

## Products

```json
{
  "id": "prod_100",
  "title": "Retail EPOS",
  "description": "Cloud POS package for retail shops.",
  "category": "POS",
  "price": 499,
  "currency": "GBP",
  "sku": "EPOS-RETAIL",
  "status": "active"
}
```

## Inventory

`product_id`, `external_id`, or `sku` must match a synced product.

```json
{
  "product_id": "prod_100",
  "sku": "EPOS-RETAIL",
  "quantity": 12,
  "location": "Main warehouse"
}
```

## Customers

```json
{
  "id": "cust_100",
  "name": "Aisha Khan",
  "email": "aisha@example.com",
  "phone": "+441234567890"
}
```

## Orders

```json
{
  "id": "ord_100",
  "order_number": "1001",
  "customer_name": "Aisha Khan",
  "customer_email": "aisha@example.com",
  "customer_phone": "+441234567890",
  "status": "paid",
  "fulfillment_status": "processing",
  "tracking_number": "TRACK123",
  "tracking_url": "https://carrier.example/track/TRACK123",
  "total": 499,
  "currency": "GBP",
  "placed_at": "2026-06-26T12:00:00Z",
  "items": [
    { "title": "Retail EPOS", "quantity": 1, "price": 499, "sku": "EPOS-RETAIL" }
  ]
}
```

## Bot Behavior

Once synced:

- Product answers come from `synced_products`.
- Stock answers come from `synced_inventory`.
- Order tracking uses `order_number` plus phone or email verification.
- The assistant should not guess prices or stock when no live source is connected.
