# Standard Help Desk Events

Standard events describe what the Help Desk can ask a connector to do. They do not contain customer business logic.

Customer logic belongs in customer-owned handler files. The connector core only receives the event, validates it, calls the registered customer handler, and posts the result.

## Ownership

- `connectors/events/standard-events.json` is connector-owned.
- Platform event definition files are connector-owned.
- Customer app detail files and event handler files are customer-owned.

Future events should be added to the event catalog first, then mirrored into platform event definition files. Do not add customer service logic to core connector files.

## Runtime Flow

```text
Help Desk queues event -> connector receives event -> event registry finds definition -> customer handler runs -> connector posts result
```

If an event is not mapped in the customer app, the connector must fail gracefully with a message such as:

```text
This event is available, but it is not implemented in this customer system yet.
```

## Adding A New Event

1. Add the event to `standard-events.json`.
2. Add docs in this file or an example under `events/examples/`.
3. Add the event to platform definition files:
   - Web: `HelpdeskStandardEvents.js`
   - Android: `StandardHelpdeskEvents.kt`
   - .NET: `StandardHelpdeskEvents.cs`
   - Laravel: `StandardHelpdeskEvents.php`
4. Do not edit customer handler logic.
5. Update tests so every platform exposes the same event names.

## Customer Mapping Examples

```text
daily_sales_report -> customer ReportService.dailySales(date, branchId)
end_of_day_report -> customer ReportService.endOfDay(date, branchId)
search_product -> customer ProductService.search(query)
create_product -> customer ProductService.create(input)
create_purchase_order -> customer PurchaseService.createOrder(input)
```

## Product And Category Inputs

When a user asks to create a product and gives a category name instead of a category ID, the customer handler should resolve it locally:

1. Look up category by `category_id` when present.
2. Otherwise look up category by `category_name`.
3. If exactly one category matches, use that category.
4. If multiple categories match, return a clear error asking the user to choose.
5. If no category exists, either create it only if the customer explicitly supports category creation, or return a clear error.

The connector should not invent IDs or write directly to the database.

## Event Categories

- Inventory: products, stock, and stock history.
- Customers: search, create, update, and notes.
- Orders: search, status, create, and cancel.
- Purchase: supplier purchase orders.
- Invoices: invoice search and summary.
- Reports: daily sales, end of day, and stock value.
- Support: internal support ticket creation.
