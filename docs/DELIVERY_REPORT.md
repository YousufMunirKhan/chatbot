# Delivery report — competitor parity build

What shipped, what it is verified against, and what a human still has to do
before each piece works in production.

---

## 1. What was built

| # | Area | Status | Migration |
|---|---|---|---|
| 1 | **Channels** — Telegram, Viber, LINE, Facebook Messenger + feed comments, Instagram Direct + post comments, TikTok comments, YouTube comments, Gmail OAuth, WhatsApp upgraded to interactive messages | Built | `0052` |
| 2 | **Flow builder** — 22 block types, 7 trigger types, NLU intents, sessions, per-node analytics, visual drag-and-drop canvas, simulator | Built | `0053` |
| 3 | **WhatsApp suite** — message templates, opt-in/opt-out, catalog selling, segmented broadcasts, green-tick and BSP-migration checklists | Built | `0054` |
| 4 | **E-commerce automations** — order confirmation / shipping / cancellation, abandoned-cart recovery, Shopify + WooCommerce webhooks | Built | `0055` |
| 5 | **Public developer platform** — REST API v1, API keys with scopes, request logs, JS SDK, developer console | Built | `0056` |
| 6 | **Agency & platform** — white-label agencies with sub-accounts, team and contact groups, Stripe auto top-up, English/Arabic interface | Built | `0057` |
| 7 | **Service levels** — per-priority/channel targets, business-hours clocks, breach warning and escalation, attainment dashboard | Built | `0058` |
| 8 | **Reports** — channel-level volume, automation rate, CSAT, flow completion | Built | — |

All seven migrations are applied to the development database.

---

## 2. Verification

```
npm run test:units   # 582 checks — no network, no database
npm run test:db      # 51 checks  — against the real database
npx tsc --noEmit     # 0 errors
```

| Suite | Checks | What it proves |
|---|---|---|
| `test-flows` | 64 | Block rendering, parking and resuming, validation + retries, branching, HTTP block, loop protection, trigger matching, intent classification |
| `test-sla` | 33 | Business-hours arithmetic across closing time and weekends, policy selection by specificity |
| `test-channels` | 79 | Every adapter's `parse()` against realistic payloads, signature verification, outbound block mapping |
| `test-whatsapp-suite` | 60 | Opt-keyword matrix incl. Arabic, template message JSON, catalog message shapes, audience resolution |
| `test-automations` | 100+ | Placeholder rendering, condition evaluation, Shopify/Woo signatures, topic→event mapping, abandonment thresholds |
| `test-public-api` | 90+ | Key generation and hashing, constant-time verification, expiry/revocation, scopes, pagination, error envelopes, SDK |
| `test-flow-builder` | 65 | Graph validation rules, every template executing through the real engine, version restore |
| `test-platform-features` | 89 | Branding resolution, group helpers, auto-top-up decision and double-charge guard, en↔ar key parity |
| `test-flows-db` | 23 | Sessions persist and resume, unique-session index, action blocks write through, **cross-tenant isolation** |
| `test-sla-db` | 26 | Idempotent clock start, response/resolution stops, breach announced exactly once, **cross-tenant isolation** |

The pure-logic suites load the **real TypeScript sources** through
`scripts/lib/ts-load.mjs` (the TypeScript compiler already in
`devDependencies`), substituting stubs only for Supabase and HTTP. They test the
code that ships, not a re-implementation.

### Bugs the tests caught

- **SLA deadlines were up to 59 seconds short.** Deadline arithmetic rounded the
  start down to a whole minute, so a 30-minute target came out at 29.4 minutes.
  Now computed in milliseconds (`src/lib/sla/schedule.ts`).
- **The build was broken by a synchronous export in a `'use server'` module.**
  `slugifyAgency` moved to `src/lib/agency.ts`.

---

## 3. Operational setup

### Scheduled jobs — none of these run by themselves

| Route | Cadence | Without it |
|---|---|---|
| `/api/cron/channels` | 2–5 min | Gmail and YouTube never receive anything (both are polled, not pushed) |
| `/api/cron/sla` | 1 min | Targets are recorded but no breach is ever flagged or escalated |
| `/api/cron/automations` | 5 min | No order or abandoned-cart message is ever sent |
| `/api/cron/broadcasts` | 5 min | Scheduled broadcasts never send |

All four take `Authorization: Bearer $CRON_SECRET`.

### Environment variables

| Variable | Needed for |
|---|---|
| `META_VERIFY_TOKEN` | Facebook / Instagram webhook handshake |
| `META_APP_SECRET` | Meta payload signatures |
| `TIKTOK_CLIENT_SECRET` | TikTok webhook signatures |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth |
| `SHOPIFY_WEBHOOK_SECRET` / `WOOCOMMERCE_WEBHOOK_SECRET` | Store webhooks — **the route returns 503 in production without them** |
| `CRON_SECRET` | All four cron routes |
| `ENCRYPTION_KEY` | Channel tokens, NLU credentials, API keys at rest |
| `NEXT_PUBLIC_APP_URL` | Webhook URLs, SDK base URL, OAuth redirects. Must be public HTTPS — Telegram and Viber refuse anything else |

### Third-party approvals still required

- **WhatsApp templates and account health** need a token with
  `whatsapp_business_management`, not just `whatsapp_business_messaging`.
- **WhatsApp catalog selling** needs a Meta commerce catalog linked to the WABA,
  and each product mapped to a `retailer_id`.
- **TikTok** comment replies need a TikTok for Business app with Comment
  Management access.
- **YouTube** needs an OAuth token with `youtube.force-ssl`.
- **Auto top-up** needs a saved Stripe payment method. This app never handles
  card numbers, so the `pm_…` id must come from Stripe's hosted setup.

---

## 4. Known limits

- **TikTok and YouTube are comment-only.** Both platforms' direct-message APIs
  are partner-gated; there is no DM path to build against.
- **Gmail and YouTube are polled, not pushed.** A Gmail Pub/Sub watch needs a
  Google Cloud topic per deployment; YouTube has no comment webhook at all.
- **Auto top-up has no automatic trigger yet.** The logic, the guard against
  double-charging and the failure cutoff are all built and tested, but the only
  wired entry point is the "Top up now" button. Hooking it into the credit-spend
  path or a cron job is a small follow-up.
- **The Arabic interface covers the shell and three pages** (`/company`,
  `/company/inbox`, `/company/settings`) plus every navigation label. The
  dictionary is typed so a missing translation is a compile error, but the
  remaining pages still render English copy.
- Nothing has been exercised against a live provider — no Meta, Telegram, LINE,
  Shopify or Stripe credentials were available in this environment.
