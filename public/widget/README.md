# Website Widget (Module 8)

The embeddable chat widget, served as a static asset.

- **`widget.js`** — a self-contained vanilla-JS widget (no framework, no build
  step). Chat bubble + window, SSE streaming replies, lead/agent messages, RTL
  (Arabic), and `data-*` configuration. Fronted by Cloudflare CDN in production.
- **`demo.html`** — a local test page (replace `PUBLIC_BOT_ID` with a real id).
- CORS + cache headers for `/widget/*` are configured in `next.config.mjs`.

## Embed on any customer site

```html
<script
  src="https://cdn.yourdomain.com/widget.js"
  data-bot-id="PUBLIC_BOT_ID"
  data-title="Acme Assistant"
  data-welcome="Hi! How can I help?"
  data-color="#2563eb"
  data-position="right"
  data-lang="auto"
></script>
```

Get the snippet (with your real bot id) from the dashboard:
**Company → Assistants → [assistant] → Settings → Embed snippet**, or
**Company → Widget**.

## Try it locally

1. `npm run dev`
2. Create an assistant and copy its `data-bot-id`
3. Edit `demo.html`, replace `PUBLIC_BOT_ID`, and open
   `http://localhost:3000/widget/demo.html`

> The widget contains **no business logic** — it only sends/receives messages.
> All logic lives in the backend AI Assistant Engine (Module 9). Domain
> allow-listing is enforced server-side (Module 23).
