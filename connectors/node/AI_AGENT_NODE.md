# Node AI Agent Instructions

Use this with `connectors/AI_AGENT_INTEGRATION_PROMPT.md` when integrating Node.js, Express, NestJS, Fastify, or a backend for a React/Vue admin app.

## First File To Edit

Use `web/HelpdeskWebAppDetails.js` as the source-of-truth template. Move its manifest, handlers, and route mapping into the app's preferred Node structure.

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

## Plug-And-Play Starter

The downloaded web connector zip includes `helpdesk-node-starter.mjs`.

Run a smoke test:

```bash
HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk \
HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk \
node helpdesk-node-starter.mjs --preview-only
```

Run preview, audit, sync, and one event poll:

```bash
HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk \
HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk \
node helpdesk-node-starter.mjs --once
```

What works immediately:

- preview
- audit
- sync
- polling
- sample product/report handlers

What the developer replaces:

- `sampleProductService`
- `sampleReportService`
- route map in `HelpdeskWebAppDetails.js`
- staff chat backend proxy

## Required Configuration

Create a connector in Switch&Save **Company -> Internal Help Desk -> Create connector**, then set:

```bash
HELPDESK_BASE_URL=https://chatbot.ssepos.co.uk
HELPDESK_CONNECTOR_TOKEN=hdk_your_token_from_help_desk
```

Keep `HELPDESK_CONNECTOR_TOKEN` on the backend only. Never expose it in public React/Vue/browser bundles.

## How Staff Open Help Desk

Add a staff-only `/admin/helpdesk` page or admin sidebar button. The page calls your backend proxy (`/admin/helpdesk/chat`) with `text`, `currentRoute`, and the authenticated staff role. Your backend attaches the `hdk_...` token when it calls Switch&Save.

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
