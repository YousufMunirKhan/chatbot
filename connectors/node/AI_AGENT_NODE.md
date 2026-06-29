# Node AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating Node.js, Express, NestJS, Fastify, or a backend for a React/Vue admin app.

## What To Inspect

Ask the developer to provide:

- routes/controllers
- auth middleware and role model
- product/stock/order/customer/report services
- route/menu/sidebar definitions
- frontend router config if chat UI is embedded
- background job/queue setup

## Recommended Structure

```text
src/helpdesk/connector.ts
src/helpdesk/manifest.ts
src/helpdesk/actions.ts
src/helpdesk/navigation.ts
src/helpdesk/worker.ts
src/helpdesk/chat-route.ts
```

## Action Registry

```ts
export const helpdeskHandlers = {
  search_product: async (input, ctx) => {
    await requireRole(ctx.user, ['admin', 'manager', 'cashier']);
    const products = await productService.search(input.query);
    return {
      results: products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
      })),
    };
  },

  update_product_price: async (input, ctx) => {
    await requireRole(ctx.user, ['admin', 'manager']);
    if (input.confirmed !== true) throw new Error('Confirmation required.');
    await productService.updatePrice(input.product_id, input.price);
    return { success: true, product_id: input.product_id, price: input.price };
  },
};
```

## Embedded Staff Chat Backend Proxy

Keep the connector token on the backend:

```ts
app.post('/admin/helpdesk/chat', requireStaff, async (req, res) => {
  const response = await fetch(`${process.env.HELPDESK_BASE_URL}/api/helpdesk/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HELPDESK_CONNECTOR_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: req.body.text,
      currentRoute: req.body.currentRoute,
      staffRole: req.user.role,
    }),
  });
  res.status(response.status).json(await response.json());
});
```

## Worker

Run a backend worker:

```text
status -> sync if needed -> poll events -> run handler -> post result
```

Prefer WebSocket when the app has a safe long-running backend process. Use polling fallback for simple deployments.

## Safety

- Do not expose `hdk_...` token in public browser bundles.
- Validate roles before handlers.
- Confirm write actions.
- Return minimal result fields.
