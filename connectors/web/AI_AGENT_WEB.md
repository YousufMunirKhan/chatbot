# Web AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating a SaaS dashboard, website admin panel, or browser-based business app.

## What To Inspect

Ask the developer to provide:

- Router config such as Next.js routes, React Router routes, Vue Router routes, or backend MVC routes.
- Sidebar/menu definitions.
- Page titles, forms, validation schemas, and permission checks.
- Backend services or API clients for product, stock, customer, invoice, order, and report actions.
- Existing admin URLs for clickable paths.

## Where The Connector Runs

Recommended production setup:

```text
Frontend admin UI -> customer backend -> Switch&Save connector API
```

The `hdk_...` token must stay on the backend. Do not expose it in public browser JavaScript.

## Embedded Staff Chat

Use `HelpdeskEmbeddedChat.js` on authenticated staff pages. The host app controls visibility with route and role:

```js
import { HelpdeskEmbeddedChatClient, shouldShowHelpdeskChat } from './HelpdeskEmbeddedChat.js';

const visible = shouldShowHelpdeskChat(settings, {
  route: router.pathname,
  role: currentUser.role,
});
```

The connector token must stay server-side or inside a trusted staff app shell. Do not expose it in a public customer website.

## Web Navigation

For clickable paths, map each screen to a route or URL:

```js
export const helpdeskNavigationTargets = [
  {
    routeId: 'inventory.add_product',
    label: 'Open Add Product',
    url: '/inventory/products/new',
  },
];
```

If the Help Desk assistant is embedded inside an authenticated admin panel, the Open button can route locally:

```js
router.push('/inventory/products/new');
```

If the button opens from outside the app, use a secure admin URL and require login.

## Web Action Handlers

Register backend handlers that call existing application services:

```js
const handlers = {
  search_product: async (input, ctx) => {
    await requireStaff(ctx.user, ['admin', 'manager', 'cashier']);
    const results = await productService.search(input.query);
    return {
      results: results.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
      })),
    };
  },
  update_product_quantity: async (input, ctx) => {
    await requireStaff(ctx.user, ['admin', 'manager']);
    await inventoryService.updateQuantity(input.product_id, input.quantity, input.reason);
    return { success: true, product_id: input.product_id, quantity: input.quantity };
  },
};
```

## Web Security

- Keep the connector token on the backend.
- Require authenticated staff for preview, sync, navigation, and write handlers.
- Do not let LLM-generated code write raw SQL.
- Do not return customer lists or invoice lists unless the specific action requested them and the user is authorized.
- Redact secrets in preview/audit output.

## Web Deliverables

Generate:

1. Backend connector service.
2. Manifest builder from routes/menu/page metadata.
3. Admin Connector Studio page for preview/edit/audit/sync.
4. Action handler registry.
5. Navigation target registry.
