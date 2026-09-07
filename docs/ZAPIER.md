# Zapier

One Zapier app reaches HubSpot, Salesforce, Pipedrive, Google Sheets, Mailchimp
and several thousand other tools. That is why this product has no native CRM
connectors and is not going to grow any: a customer who wants new enquiries in
their CRM builds a two-step Zap in about ninety seconds, and every tool Zapier
already supports comes along for free.

The work is split in two places, and it matters which is which:

| Where | What |
| --- | --- |
| **This repository** | `/api/v1/hooks` (subscribe / unsubscribe), `/api/v1/auth/me`, the four events, delivery, migration `0079_rest_hooks.sql`, and the app source in `zapier/`. |
| **Zapier's platform** | The app itself. `zapier/` is pushed there with the Zapier CLI; it is never deployed with the site. |

---

## What a customer does

1. **Create an API key.** Company → Developers → API keys → **Full access**.
   The key starts with `ak_live_` and is shown once. API access is included on
   Pro and Custom; on Free trial, Starter or Growth the connection test answers
   `402` and says which package to change to.
2. **Connect the account in Zapier.** Search for the app, then fill in:
   - **Account URL** — the address they sign in to, e.g. `https://app.example.com`.
   - **API key** — the key from step 1.
   Zapier calls `GET /api/v1/auth/me` and labels the connection with the
   company name, so several accounts can be connected side by side.
3. **Build a Zap.** Pick a trigger, press Test, map the fields, choose what
   happens next. Nothing else needs configuring on our side: turning the Zap on
   subscribes it, turning it off unsubscribes it.

### Triggers

All four are REST hooks — they fire as things happen, rather than Zapier asking
every fifteen minutes whether anything has.

| Trigger | Event | Fires when |
| --- | --- | --- |
| New Enquiry | `enquiry.created` | Someone leaves their details — chat, pre-chat form, quick action, guided flow, or your own systems through the API. |
| New Conversation | `conversation.created` | A customer starts a conversation on any channel. |
| Conversation Closed | `conversation.closed` | A conversation is closed, by an agent or by the assistant. |
| New Order | `order.placed` | A customer places an order in a conversation. |

Each carries the whole record, with the same field names `/api/v1` uses for that
object — so a field mapped in the Zap editor is the field that arrives later.

**Orders synced from a connected store do not fire New Order.** They arrive in
bulk on every sync, and a first Shopify import would set off thousands of Zaps
in one minute. Shopify and WooCommerce have their own Zapier apps for that.

### Actions

| Action | Endpoint | Notes |
| --- | --- | --- |
| Send Message | `POST /api/v1/messages` | Reply inside a conversation, or start one by giving Channel + To. Returns whether the channel actually delivered it, so a Zap can branch on a failure. |
| Create Enquiry | `POST /api/v1/contacts` | Needs at least one of Name, Email or Phone. |

> **One thing to watch.** Create Enquiry writes the same kind of record New
> Enquiry watches, so a Zap that creates enquiries will set off a Zap that
> listens for them. That is occasionally what someone wants and usually not —
> if both exist in one account, put a filter step on the listening Zap
> (`Source` is not `api`).

---

## How it works

```
lead / conversation / order written
        │  database trigger (migration 0079) — only if someone is subscribed
        ▼
  rest_hook_events                (outbox, in Postgres)
        │  GET /api/v1/hooks/dispatch, every minute, CRON_SECRET
        ▼
  dispatchWebhookEvent()          (src/lib/webhooks.ts — unchanged)
        │  HMAC-SHA256 signed POST, one retry, metered, logged
        ▼
  https://hooks.zapier.com/…
```

A subscription is stored as a `webhook_endpoints` row of kind `rest_hook`, which
is what makes all of that free: the signing, the retry, the per-plan delivery
budget and the delivery log on Company → Webhooks are the ones that were already
there. Zapier subscriptions show up on that page like any other endpoint, and
deleting one there stops the deliveries immediately.

**Why the events are raised from the tables** rather than from the code that
writes them: the existing `lead.created` notification carries a title and a
sentence of prose, not an email address, and it is only raised on some of the
paths that capture an enquiry — an enquiry created through the API raised
`contact.created` instead, and nothing raised anything for a conversation. A
trigger on the table catches every write path exactly once and can attach the
whole record.

**Failing subscriptions are disabled, not retried forever.** When a Zap is
deleted, Zapier simply stops answering its URL and never tells us. Five
consecutive failed deliveries deactivate the endpoint and stamp the subscription
with the reason; nothing is delivered to it again until it is re-subscribed
(which happens by itself when the customer turns the Zap back on). A company
that loses API access has its subscriptions disabled on the next dispatch — its
own webhook endpoints are untouched.

### The endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/auth/me` | Connection test. Company, plan, and the key's scopes. |
| `GET` | `/api/v1/hooks` | The subscriptions this account holds. |
| `POST` | `/api/v1/hooks` | Subscribe: `{ "event": "...", "target_url": "https://...", "label": "...", "client": "zapier" }`. Idempotent per event + URL. |
| `DELETE` | `/api/v1/hooks/{id}` | Unsubscribe. |
| `GET` | `/api/v1/hooks/samples?event=…` | The last few real records for an event — what the Zap editor shows as test data. |
| `GET` | `/api/v1/hooks/dispatch` | Not for customers: the scheduled dispatcher, `CRON_SECRET` only. |

Scopes: the hook routes ask for `conversations:read`, and the event's own scope
is then checked per subscription — `contacts:read` for enquiries, `orders:read`
for orders, `conversations:read` for conversations. The error names the missing
scope. A Full access key avoids the question entirely, which is what the app's
help text tells people to create.

Limits: **25 live subscriptions per company** (a Zap is one subscription), and
the 120 requests/minute API rate limit applies to the subscribe and unsubscribe
calls like any other.

Try it without Zapier — any URL that accepts a POST will do:

```bash
curl -X POST https://app.example.com/api/v1/hooks \
  -H "Authorization: Bearer ak_live_…" \
  -H "Content-Type: application/json" \
  -d '{"event":"enquiry.created","target_url":"https://example.com/hook","label":"Test"}'
```

The delivered body is the platform's standard webhook envelope, signed with
`X-Webhook-Signature: sha256=…` over the raw body:

```json
{
  "event": "enquiry.created",
  "created_at": "2026-01-01T09:00:00.000Z",
  "company_id": "…",
  "title": "New enquiry",
  "body": "person@example.com",
  "data": { "id": "…", "name": "Sample Person", "email": "person@example.com", "…": "…" }
}
```

---

## Pushing the app

The app is a private Zapier integration until Zapier approves it for the public
directory; private is enough to invite customers by link.

```bash
npm install -g zapier-platform-cli
zapier login                       # a Zapier account with access to the app

cd zapier
npm install

# First time only — creates the app on Zapier and writes .zapierapprc (ignored).
zapier register "AI Assistant"

zapier validate                    # schema + style checks
zapier push                        # uploads this directory as a new version
zapier test                        # optional: runs the app's own tests
```

Then, in Zapier's developer console:

- **Test the connection** with a real `ak_live_` key against a real account.
  Build one Zap per trigger and confirm the Test step shows real data — that
  step calls `/api/v1/hooks/samples`, so an account with no enquiries at all
  will legitimately show none.
- **Invite customers** with the app's sharing link, or submit it to the app
  directory once ten or so accounts are using it (Zapier's threshold for a
  public listing).

Releasing a change:

```bash
cd zapier
npm version patch                  # the app version comes from package.json
zapier push
zapier promote 1.0.1               # make it the version new Zaps use
zapier migrate 1.0.0 1.0.1         # move existing users across
```

Never change a trigger's `key` or an output field's `key` in a released
version — every Zap a customer has built maps fields by those names, and
renaming one breaks all of them silently. Add a new field instead.

---

## Installing this end (once)

1. **Run migration `0079_rest_hooks.sql`.** It creates the subscription and
   outbox tables, the four events, the triggers that raise them, and the kill
   switch.
2. **Schedule the dispatcher.** In `vercel.json`, add:

   ```json
   { "path": "/api/v1/hooks/dispatch", "schedule": "* * * * *" }
   ```

   Without it the triggers keep queueing events and nothing ever sends them.
   Every minute matches `/api/cron/sla`; anything up to five minutes is fine if
   cron entries are scarce.
3. **Check `CRON_SECRET` is set** in the environment. The dispatcher answers
   `503 cron_not_configured` without it, exactly like the other sweeps.

Verify the whole path end to end:

```bash
# 1. subscribe a test URL, 2. cause an enquiry, 3. run the dispatcher by hand
curl -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/v1/hooks/dispatch
# → {"ok":true,"claimed":1,"dispatched":1,"disabledCompanies":0,"pruned":0}
```

`claimed: 0` when something clearly happened means the database trigger found
nobody subscribed — check that the endpoint row is `active` and that its
`events` array holds the exact event name.
