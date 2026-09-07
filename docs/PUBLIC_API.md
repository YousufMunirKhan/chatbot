# Public REST API (v1)

Build on top of your assistant: read conversations, send messages, manage
contacts, pull orders and products, schedule broadcasts, and fetch analytics —
all from your own systems.

Everything lives under `{APP_URL}/api/v1`, where `{APP_URL}` is the value of
`NEXT_PUBLIC_APP_URL` for your installation (shown on **Company → Developers**).

- **API keys and request logs:** Company → Developers
- **Webhook endpoints:** Company → Webhooks
- **JavaScript SDK:** `{APP_URL}/sdk/assistant.js` (types: `{APP_URL}/sdk/assistant.d.ts`)

---

## Authentication

Every request needs a bearer token:

```
Authorization: Bearer ak_live_<your key>
```

Keys are created on **Company → Developers**. A key looks like
`ak_live_` followed by 32 random characters.

**The full key is shown exactly once, at creation.** Only a SHA-256 hash and the
first 12 characters are stored, so we cannot recover it later — if you lose it,
revoke the key and create another.

Keys are **server-side credentials**. A key grants access to everything its
scopes allow for your company; never put one in a browser bundle, a mobile app,
or a public repository.

### Scopes

A key carries an explicit list of scopes, or the `*` wildcard ("full access").
A request whose scope is not held returns `403 forbidden`.

| Scope                  | Grants                                            |
| ---------------------- | ------------------------------------------------- |
| `conversations:read`   | `GET /conversations`, `GET /conversations/{id}`    |
| `conversations:write`  | `POST /messages`                                   |
| `contacts:read`        | `GET /contacts`, `GET /contacts/{id}`              |
| `contacts:write`       | `POST /contacts`                                   |
| `orders:read`          | `GET /orders`                                      |
| `products:read`        | `GET /products`                                    |
| `broadcasts:write`     | `POST /broadcasts`                                 |
| `analytics:read`       | `GET /analytics/summary`                           |
| `*`                    | Everything above, including scopes added later     |

### Expiry and revocation

A key can be created with an expiry (30/90/365 days) or with none. Expired and
revoked keys are rejected with `401 unauthorized`. Revoking is immediate and
permanent; the key row is kept so the request log stays readable.

### Tenant isolation

A key resolves to exactly one company. Every query the API runs is filtered by
that company id, and no request parameter can widen it. An id belonging to
another company returns `404 not_found`, never that company's data.

---

## Rate limits

**120 requests per minute per API key.** Exceeding it returns `429 rate_limited`
with a `Retry-After: 60` header. Every response carries
`X-RateLimit-Limit: 120`.

The bundled SDK retries `429` and `5xx` automatically with exponential backoff,
honouring `Retry-After`.

---

## Request and response format

Requests with a body must send `Content-Type: application/json`.

Success — list endpoints:

```json
{
  "data": [ { "...": "..." } ],
  "meta": { "page": 1, "per_page": 25, "total": 137 }
}
```

Success — single-resource endpoints:

```json
{ "data": { "...": "..." } }
```

Errors:

```json
{ "error": { "code": "not_found", "message": "Conversation not found." } }
```

### Pagination

| Parameter  | Default | Max | Notes                    |
| ---------- | ------- | --- | ------------------------ |
| `page`     | `1`     | —   | 1-based                  |
| `per_page` | `25`    | 100 | Values above 100 clamp   |

`meta.total` is the total number of matching rows, not the number returned.

### Error codes

| Code              | HTTP | Meaning                                                   |
| ----------------- | ---- | --------------------------------------------------------- |
| `unauthorized`    | 401  | Missing, malformed, revoked or expired key                 |
| `forbidden`       | 403  | Key does not hold the required scope                       |
| `invalid_request` | 400  | Bad JSON, bad parameter, or failed validation              |
| `not_found`       | 404  | No such resource **for this company**                      |
| `conflict`        | 409  | The resource is in a state that forbids the operation      |
| `rate_limited`    | 429  | Over 120 requests/minute                                   |
| `not_configured`  | 503  | A required server-side integration is not set up           |
| `internal_error`  | 500  | Unexpected failure — safe to retry                         |

---

## Endpoints

### `GET /api/v1/conversations`

Scope: `conversations:read`

| Query      | Type   | Notes                                                                 |
| ---------- | ------ | --------------------------------------------------------------------- |
| `page`     | int    |                                                                       |
| `per_page` | int    | Max 100                                                               |
| `status`   | string | `ai_active`, `needs_human`, `human_active`, `closed`, `expired`       |
| `channel`  | string | `web_chat`, `whatsapp`, `instagram`, `facebook`, `email`, `telegram`… |
| `since`    | ISO    | Only conversations with activity at or after this instant             |

Ordered by `last_message_at` descending.

```bash
curl "$APP_URL/api/v1/conversations?status=human_active&per_page=10" \
  -H "Authorization: Bearer $ASSISTANT_API_KEY"
```

```json
{
  "data": [
    {
      "id": "6f1c…",
      "channel": "whatsapp",
      "status": "human_active",
      "language": "en",
      "visitor_id": "+14155551234",
      "customer_id": null,
      "assigned_agent_id": "9a2b…",
      "ai_enabled": false,
      "unread_count": 2,
      "started_at": "2026-09-01T10:04:00.000Z",
      "last_message_at": "2026-09-01T10:22:11.000Z",
      "closed_at": null
    }
  ],
  "meta": { "page": 1, "per_page": 10, "total": 3 }
}
```

### `GET /api/v1/conversations/{id}`

Scope: `conversations:read`

Returns the conversation plus up to **200** messages in chronological order.

```json
{
  "data": {
    "id": "6f1c…",
    "channel": "whatsapp",
    "status": "human_active",
    "messages": [
      {
        "id": "1b0e…",
        "conversation_id": "6f1c…",
        "channel": "whatsapp",
        "sender_type": "visitor",
        "sender_id": "+14155551234",
        "content_text": "Where is my order?",
        "content_type": "text",
        "language": "en",
        "created_at": "2026-09-01T10:04:00.000Z"
      }
    ]
  }
}
```

### `POST /api/v1/messages`

Scope: `conversations:write`

Send a message into an existing conversation, or start one on a channel.

| Field             | Type   | Notes                                                      |
| ----------------- | ------ | ---------------------------------------------------------- |
| `text`            | string | **Required.** 1–4000 characters                            |
| `conversation_id` | uuid   | Required unless `channel` + `to` are given                 |
| `channel`         | string | With `to`, starts a new conversation                       |
| `to`              | string | Recipient on that channel (phone, page-scoped id, address) |

The message row is written first and delivery is reported separately, so you
can always see what was said even when the channel provider rejected the send.

```bash
curl -X POST "$APP_URL/api/v1/messages" \
  -H "Authorization: Bearer $ASSISTANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"6f1c…","text":"Your order shipped today."}'
```

```json
{
  "data": {
    "id": "44ad…",
    "conversation_id": "6f1c…",
    "sender_type": "agent",
    "content_text": "Your order shipped today.",
    "created_at": "2026-09-01T10:25:00.000Z",
    "delivery": { "delivered": true, "transport": "channel", "reason": null }
  }
}
```

`delivery.transport` is `in_app` for `web_chat`, `api`, `voice` and `phone`
conversations (the widget and inbox read the row directly) and `channel` when
the message was handed to WhatsApp, Telegram, email, etc. `reason` explains a
`delivered: false` — most often that no active channel of that type is
connected.

Responds `201 Created`.

### `GET /api/v1/contacts`

Scope: `contacts:read`

Contacts are the leads your assistant captures, plus anything you create through
this API. (Customer records mirrored from a connected store are owned by that
connector and are not exposed here.)

| Query      | Type   | Notes                                                       |
| ---------- | ------ | ----------------------------------------------------------- |
| `page`     | int    |                                                             |
| `per_page` | int    | Max 100                                                     |
| `status`   | string | `new`, `contacted`, `qualified`, `converted`, `closed`      |
| `source`   | string | e.g. `chat`, `api`                                          |
| `since`    | ISO    | Created at or after this instant                            |
| `q`        | string | Case-insensitive match on name, email or phone              |

### `POST /api/v1/contacts`

Scope: `contacts:write`

At least one of `name`, `email` or `phone` is required. `source` is always
recorded as `api`. Fires the `contact.created` webhook event.

```bash
curl -X POST "$APP_URL/api/v1/contacts" \
  -H "Authorization: Bearer $ASSISTANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","enquiry_type":"demo"}'
```

Responds `201 Created` with the created contact.

### `GET /api/v1/contacts/{id}`

Scope: `contacts:read`

### `GET /api/v1/orders`

Scope: `orders:read`

| Query      | Type   | Notes                                              |
| ---------- | ------ | -------------------------------------------------- |
| `source`   | string | `chat` (default) or `synced`                       |
| `status`   | string | Provider/store status                              |
| `since`    | ISO    | Created at or after this instant                   |
| `page`     | int    |                                                    |
| `per_page` | int    | Max 100                                            |

`chat` orders were placed in conversation; `synced` orders are mirrored from a
connected store. They are separate tables, so one call returns one source —
paginating a union would make `meta.total` meaningless.

### `GET /api/v1/products`

Scope: `products:read`

| Query      | Type   | Notes                                |
| ---------- | ------ | ------------------------------------ |
| `category` | string |                                      |
| `status`   | string | e.g. `active`                        |
| `q`        | string | Matches title or SKU                 |
| `page`     | int    |                                      |
| `per_page` | int    | Max 100                              |

### `POST /api/v1/broadcasts`

Scope: `broadcasts:write`

| Field         | Type   | Notes                                        |
| ------------- | ------ | -------------------------------------------- |
| `channel`     | string | **Required.** `whatsapp` or `email`          |
| `message`     | string | **Required.** 1–2000 characters              |
| `subject`     | string | Email only                                   |
| `schedule_at` | ISO    | Omitted or in the past → next dispatcher run |

Creates a scheduled broadcast to the contact list. The existing broadcast
dispatcher does the sending, so API callers cannot bypass its limits. Fires the
`broadcast.created` webhook event. Responds `201 Created`.

### `GET /api/v1/analytics/summary`

Scope: `analytics:read`

| Query  | Type | Notes                                        |
| ------ | ---- | -------------------------------------------- |
| `from` | ISO  | Default: 30 days ago                         |
| `to`   | ISO  | Default: now                                 |

The window may not exceed 366 days.

```json
{
  "data": {
    "range": { "from": "2026-08-08T00:00:00.000Z", "to": "2026-09-07T00:00:00.000Z" },
    "conversations": { "started": 412, "closed": 388 },
    "messages": { "total": 5124, "visitor": 2310, "ai": 2401, "agent": 413 },
    "leads": 87,
    "appointments": 21,
    "orders": 44
  }
}
```

---

## Webhooks

Subscribe an HTTPS endpoint on **Company → Webhooks**, choose the events you
care about, and verify the signature on every delivery. The full event
catalogue — with a sample payload and a **Send test** button for each event —
is on **Company → Developers**.

| Event                 | Fires when                                            |
| --------------------- | ----------------------------------------------------- |
| `lead.created`        | A visitor leaves contact details in chat              |
| `appointment.created` | A visitor requests a booking or callback              |
| `order.created`       | An order is placed in chat or synced from a store     |
| `ticket.created`      | A conversation is escalated to a human                |
| `ticket.resolved`     | An agent resolves an escalated conversation           |
| `contact.created`     | `POST /api/v1/contacts` succeeds                      |
| `message.sent`        | `POST /api/v1/messages` succeeds                      |
| `broadcast.created`   | `POST /api/v1/broadcasts` succeeds                    |

Delivery envelope:

```
POST  (your endpoint)
Content-Type: application/json
X-Webhook-Event: contact.created
X-Webhook-Signature: sha256=<hmac>

{
  "event": "contact.created",
  "created_at": "2026-09-07T10:00:00.000Z",
  "company_id": "…",
  "title": "New contact: Ada Lovelace",
  "body": null,
  "data": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com" }
}
```

Verify it:

```js
import crypto from 'crypto';

const expected =
  'sha256=' +
  crypto.createHmac('sha256', YOUR_SIGNING_SECRET).update(rawRequestBody).digest('hex');

if (req.headers['x-webhook-signature'] !== expected) reject(401);
```

Deliveries are retried once on failure and are metered against your plan's
monthly webhook budget; the delivery log is on **Company → Webhooks**.

---

## JavaScript SDK

A dependency-free UMD build served from your own installation:

```
{APP_URL}/sdk/assistant.js
{APP_URL}/sdk/assistant.d.ts
```

```js
const AIAssistant = require('./assistant.js'); // or <script src="…/sdk/assistant.js"></script>

const assistant = new AIAssistant({
  apiKey: process.env.ASSISTANT_API_KEY,
  baseUrl: process.env.APP_URL,
  timeoutMs: 15000, // per attempt, default 15s
  maxRetries: 2,    // 429 / 5xx / network, default 2
  // fetch: nodeFetch, // Node < 18 only
});

const { data, meta } = await assistant.conversations.list({ status: 'human_active' });
const conversation = await assistant.conversations.get(data[0].id);

await assistant.messages.send({ conversation_id: data[0].id, text: 'Hello 👋' });

await assistant.contacts.create({ name: 'Ada Lovelace', email: 'ada@example.com' });
const contacts = await assistant.contacts.list({ q: 'ada', per_page: 50 });

const orders = await assistant.orders.list({ source: 'synced' });
const products = await assistant.products.list({ q: 'espresso' });
const summary = await assistant.analytics.summary({ from: '2026-08-01T00:00:00Z' });

await assistant.broadcasts.create({ channel: 'email', subject: 'News', message: 'Hi!' });
```

Errors throw a `AIAssistantError` carrying the API's own `code` and `status`:

```js
try {
  await assistant.contacts.create({});
} catch (err) {
  if (err.code === 'invalid_request') console.error(err.status, err.message);
}
```

The SDK is **server-side only** — it sends your API key on every request.

---

## Operational notes

- Requests are logged (method, path, status, duration, IP) and visible for your
  company on **Company → Developers**.
- `last_used_at` on a key is refreshed at most once a minute, so it is accurate
  to the minute rather than to the request.
- The API sends no CORS headers: it is meant to be called from your backend, not
  from a browser.
