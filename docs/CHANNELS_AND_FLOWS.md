# Channels, flows and service levels

How a customer message travels from any platform to an answer, and how to
configure each part.

---

## 1. The message pipeline

Every channel funnels into the same three stages. Nothing below the adapter
layer knows which platform a message came from.

```
provider webhook / poller
        │
        ▼
  ChannelAdapter.parse()          src/lib/channels/adapters/*.ts
        │  → InboundEvent[]        (normalised: externalId, from, text, kind)
        ▼
  handleInboundEvents()           src/lib/channels/handler.ts
        │  dedupe → resolve tenant → opt-out keywords
        ▼
  processInboundMessage()         src/lib/ai/inbound.ts
        │
        ├── runFlowTurn()         src/lib/flows/runtime.ts   ← flows answer first
        │       └── no match / hands back
        └── AI (RAG + tools)      src/lib/ai/engine.ts
        │
        ▼
  ChannelAdapter.send()           blocks → the platform's native message types
```

Two properties matter and are enforced in the database, not in memory:

- **Exactly-once.** `channel_inbound_events` has a unique index on
  `(channel, message_id)`. Providers retry aggressively; a duplicate insert
  fails, which is the signal to drop the delivery.
- **One tenant per address.** `channel_identities` is unique on
  `(channel, external_id)`, and `resolveChannelIdentity` refuses to serve a bot
  belonging to a different company than the address.

---

## 2. Channels

| Channel | Inbound | Outbound | Rich messages | Comments |
|---|---|---|---|---|
| WhatsApp | webhook | Cloud API | buttons (≤3), list (≤10), media | — |
| Facebook | webhook | Send API | buttons, quick replies, carousel | feed |
| Instagram | webhook | Send API | buttons, quick replies, carousel | posts |
| Telegram | webhook | Bot API | inline keyboard, cards, media | — |
| Viber | webhook | Public Account API | keyboard, media | — |
| LINE | webhook | reply + push | buttons, carousel, quick replies | — |
| TikTok | webhook | comment reply | — | video comments |
| YouTube | polled | comment reply | — | channel comments |
| Email / Gmail | webhook / polled | SMTP API or Gmail API | plain text | — |

### Webhook URLs

Static routes (unchanged, already configured in production):

```
/api/webhooks/whatsapp
/api/webhooks/instagram
/api/webhooks/email
```

Everything else is served by one dynamic route, plus a Facebook alias:

```
/api/webhooks/telegram?id=<bot id>
/api/webhooks/viber?id=<account id>
/api/webhooks/line
/api/webhooks/facebook
/api/webhooks/tiktok?id=<creator open id>
/api/webhooks/youtube?id=<channel id>
```

Telegram and Viber do not name the receiving account in their payloads, which is
why those two carry `?id=`. Saving one of those channels registers the webhook
with the provider automatically.

### Polled channels

`GET /api/cron/channels` with `Authorization: Bearer $CRON_SECRET`, every 2–5
minutes. It polls connected Gmail mailboxes and YouTube channels. Gmail marks
mail read only after the reply is sent, so a crash re-delivers rather than
losing the message; the dedupe table stops a second answer.

### Public comments

Instagram, Facebook, TikTok and YouTube deliver comments as well as messages.
Per connected account, `settings_json.commentReply` chooses:

- `private_with_ack` (default) — DM the real answer, then post a short public
  acknowledgement.
- `public` — answer in the thread.
- `off` — ignore comments.

`channel_comment_events` is unique on `(channel, comment_id)`, so two concurrent
webhook deliveries cannot both post a public reply.

---

## 3. Flows

A flow is a graph stored as one JSONB document on `flows.graph_json`. It runs
**before** the AI on every channel, including the website widget.

### Blocks

| Group | Blocks |
|---|---|
| Content | `message` `image` `video` `file` `gallery` |
| Questions | `ask` `buttons` `quick_replies` `csat` |
| Logic | `condition` `random` `delay` `jump` `end` |
| Actions | `tag` `assign` `handoff` `save_lead` `http` `ai` `subscribe` |

`ask`, `buttons`, `quick_replies` and `csat` stop the run and park the flow on
that node; the next customer message resumes from there.

### Wiring

An edge's `sourceHandle` selects which output of a node it leaves from:

- a choice's `id` — for `buttons` / `quick_replies`
- `true` / `false` — for `condition` and `http`
- `fallback` — the path taken when a reply matches no choice
- `default` — everything else

A choice with no wire of its own falls through to the node's `default` output.
A menu with **no** `fallback` wired hands the turn to the AI instead of
repeating the buttons — the customer asked something the menu did not cover.

### Variables

`{{name}}` in any text field is replaced from flow state. Always available:
`contact_name`, `contact_id`, `channel`, `last_message`, `last_choice`, and
`csat_rating` once collected. `ask` stores its answer under the variable you
name; `http` stores mapped response paths.

Validation on `ask` (`email`, `phone`, `number`, `date`, `url`) re-prompts with
`retryText` up to `maxRetries` times, then accepts the raw answer rather than
trapping the customer in a loop.

### Triggers

| Type | Fires when |
|---|---|
| `keyword` | the message matches (`exact` / `contains` / `starts_with` / `regex`) |
| `referral` | the entry-point ref parameter matches |
| `ad` | the click-to-message ad id matches |
| `comment` | the event is a public post comment |
| `intent` | the NLU classifier returns this intent |
| `welcome` | the conversation's first message |
| `event` | a named event raised by an automation or the API |

When several match: higher `flows.priority` wins, then trigger specificity
(`ad` > `referral` > `comment` > `keyword` > `intent` > `event` > `welcome`),
then the longer keyword. Live triggers are cached per company for 15 seconds, so
an account with no flows adds one indexed lookup per message and nothing more.

### Intents

The built-in classifier scores the message against each intent's example phrases
with token-overlap similarity — deliberately not an LLM call, because trigger
matching runs on every inbound message. Set `nlu_settings.provider` to `wit` or
`intnt` to use a trained model instead; an external provider that is unreachable
or returns an intent this company never defined falls back to the built-in one.

---

## 4. Service levels

`sla_policies` holds one row per target. The most specific active policy wins:
a rule for "urgent + WhatsApp" beats one for "urgent", which beats the
catch-all, regardless of row order. `sla_policies.priority` is the tie-break.

The clock starts when a conversation needs a human (an escalation, or a flow
`handoff` block), stops on the first agent reply, and a second clock stops when
the conversation closes. With `business_hours_only`, only minutes inside
`company_business_hours` count — a Friday-evening message with a 60-minute
target is due Monday morning, not Saturday.

Deadlines are computed once and stored, so the breach sweep is an index scan:

```
GET /api/cron/sla   Authorization: Bearer $CRON_SECRET
```

Run it every minute. It warns before a deadline (`escalate_before_minutes`),
flags breaches, and escalates to `escalate_to_user_id` where one is named. Each
row is claimed with a conditional update before its notification is sent, so a
breach is announced exactly once even if two sweeps overlap.

---

## 5. Configuration

### Environment

| Variable | Needed for |
|---|---|
| `META_VERIFY_TOKEN` | Facebook / Instagram webhook handshake (falls back to `WHATSAPP_VERIFY_TOKEN`) |
| `META_APP_SECRET` | Meta payload signatures (falls back to `WHATSAPP_APP_SECRET`) |
| `TIKTOK_CLIENT_SECRET` | TikTok webhook signatures |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth |
| `CRON_SECRET` | every cron route |
| `NEXT_PUBLIC_APP_URL` | webhook URLs shown on the Channels screen; must be public HTTPS for Telegram and Viber |
| `ENCRYPTION_KEY` | channel tokens and NLU credentials at rest |

### Migrations

```bash
npm run db:migrate
```

`0052` channels · `0053` flows · `0058` service levels.

### Scheduled jobs

| Route | Cadence |
|---|---|
| `/api/cron/channels` | 2–5 min |
| `/api/cron/sla` | 1 min |
| `/api/cron/broadcasts` | 5 min |
| `/api/cron/automations` | 5 min |

---

## 6. Tests

```bash
npm run test:flows      # 64 checks — engine, triggers, intents
npm run test:sla        # 33 checks — business hours, policy selection
npm run test:channels   # adapter parsing, signatures, block mapping
npm run test:units      # the pure-logic suites together
```

These need no database, no network and no provider credentials:
`scripts/lib/ts-load.mjs` transpiles the real TypeScript sources with the
compiler already in `devDependencies` and substitutes stubs for Supabase and
HTTP, so the code under test is the code that ships.
