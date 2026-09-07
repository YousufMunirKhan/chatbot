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
  async
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

`async` is part of the snippet, not an optimisation to add later: the file is a
few tens of kilobytes and a blocking tag holds up the customer's page render for
as long as it takes to fetch. Nothing in `widget.js` needs to run before the
page has parsed — it finds its own tag, and boots on DOMContentLoaded or
straight away if that has already fired — and there is no global API for a host
page to call, so no host script can depend on the widget having run yet.

## Pre-chat form and out-of-hours

Both are per company and live in `widget_prechat_settings` (migration `0068`),
edited under **Company → Widget → Getting contact details**:

- **Pre-chat form** — asks for name/email/phone before the first message. Off by
  default. `prechat_required` decides whether the asked-for fields are
  mandatory; `prechat_allow_skip` decides whether there is a visible way past
  it. What the browser draws is re-checked server-side in
  `/api/widget/prechat`, so a stripped `required` attribute buys nothing.
- **Out of hours** — when `isCompanyOpenNow()` (built on
  `company_business_hours`) says the company is closed, the widget says so and
  offers to take a message. A company with **no** opening hours on file reads as
  *unknown*, and unknown deliberately shows the ordinary chat.

Both capture routes write to `leads` alongside the quick-action forms, and echo
the details into the transcript so an agent sees them in place.

## Restoring a conversation

`GET /api/widget/transcript` replays the last messages of a conversation the
visitor owns (unguessable id + matching `visitorId`), so a page refresh no
longer empties the window. `/api/chat/messages` is a different endpoint for a
different job — it returns only agent/system messages as the backstop for the
realtime stream, and replaying the visitor's own words there would duplicate
every bubble already on screen.

## Try it locally

1. `npm run dev`
2. Create an assistant and copy its `data-bot-id`
3. Edit `demo.html`, replace `PUBLIC_BOT_ID`, and open
   `http://localhost:3000/widget/demo.html`

> The widget contains **no business logic** — it only sends/receives messages.
> All logic lives in the backend AI Assistant Engine (Module 9). Domain
> allow-listing is enforced server-side (Module 23).
