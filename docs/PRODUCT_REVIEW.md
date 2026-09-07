# Product review — the feature-parity batch

A walk through the product as a shop owner, not as an engineer. Every finding is traced
to a file and line. Where I could not confirm something I say "unverified" rather than
guess.

**Snapshot: 7 September 2026, working tree at `8d96d9a` plus uncommitted changes.**
The tree moved while I reviewed it — `src/app/(dashboard)/company/settings/page.tsx` and
`src/app/(dashboard)/layout.tsx` both changed mid-review, and
`src/components/dashboard-nav-items.ts` is untracked. Line numbers in the navigation and
settings findings may have shifted; the substance has been re-checked against the tree as
it stood at the end.

**Overall.** The engineering is better than the product. Ten channel adapters, a real
visual flow engine, HMAC verification on store webhooks, an Arabic opt-out keyword
matrix, atomic claim patterns on every background job, and a public API that is the
cleanest thing in the repository. What is missing is the last mile: features nothing
links to, features nothing calls, promises the UI makes that the code does not keep, and
a deployment story that leaves four background jobs unscheduled. A shop owner logging in
today would not find most of what shipped, and several things they did find would fail
silently.

---

## The top 10, ranked

| # | Finding | Severity |
|---|---|---|
| 1 | Store automations send to customers who replied STOP | **Blocker** — legal |
| 2 | Four background jobs are unscheduled; four features silently do nothing | **Blocker** |
| 3 | Most of the new batch has no entry point in the UI | **Blocker** |
| 4 | Every new environment variable is missing from the example config *and* the env checker | **Blocker** |
| 5 | The public SDK is branded with the competitor's name | **Blocker** — brand/legal |
| 6 | "Automatic top-up" is a manual button; running out of credit kills the bot with no warning | **Blocker** |
| 7 | WhatsApp drops every non-text message; Instagram comments never arrive | **Blocker** for two headline claims |
| 8 | "Sync from Meta" destroys the user's own template text | **Blocker** — data loss |
| 9 | Connecting a channel never validates the credential, and nothing reports a channel that has died | **Confusing**, high frequency |
| 10 | Two SLA systems, two business-hours settings, and the new one is timezone-blind | **Confusing** |

---

## 1. Blockers

### 1.1 Store automations ignore opt-outs

**Trying to do:** send an order confirmation over WhatsApp.
**What happens:** it is also sent to people who replied STOP.

`src/lib/commerce/automations.ts:122-142` queries `contact_subscriptions` filtering on a
column named `contact`:

```ts
.eq('contact', contact)
...
if (error || !data?.length) return false;
```

The table has no such column. `supabase/migrations/0054_whatsapp_suite.sql:60-72` defines
`contact_identifier` and `opted_in`. The query therefore errors on every call, the
`if (error …) return false` swallows it, and the function reports "not opted out" for
everyone. The row predicate at `:135-137` is wrong too — it looks for `opted_out`,
`is_subscribed` and `status`, none of which exist; the real signal `opted_in === false` is
never read. The surrounding `try/catch` was written to tolerate a missing table
(`:117-120`) and instead masks a permanent schema mismatch.

This is a WhatsApp Business Policy violation and a GDPR/PDPL problem. It is also the
third independent implementation of consent in the codebase — the broadcast cron has its
own (`src/app/api/cron/broadcasts/route.ts:148-167`) and `src/lib/channels/subscriptions.ts`
exports `isOptedIn`/`listOptedOut`/`listOptedIn` which nothing imports.

**Fix.** Delete the local copy, export one `isOptedOut(companyId, channel, identifier)`
from `subscriptions.ts`, and have all three callers use it. Make it **fail closed** — a
consent check that errors must block the send, not allow it. Normalise the phone to
`+digits` before comparing; `automation-templates.ts:337-341` currently passes the raw
Shopify string, so `(555) 123-4567` would not match even after the column fix.

### 1.2 Four background jobs, nothing schedules them

**Trying to do:** anything time-based.
**What happens:** nothing, forever, with no error.

There is no `vercel.json`, no GitHub Actions workflow, and no scheduler config of any kind
in the repository. The cadences exist only as a prose table in
`docs/CHANNELS_AND_FLOWS.md:219-227`. `docs/DEPLOYMENT.md` contains **zero** occurrences
of "cron" — the one document a deployer opens omits all four jobs.

What breaks: `/api/cron/sla` (no breach warnings, every figure on `/company/sla` stays
zero), `/api/cron/broadcasts` (no bulk message sends), `/api/cron/automations` (no order,
shipping, cancellation or abandoned-cart message sends), `/api/cron/channels` (Gmail and
YouTube never poll).

Meanwhile the UI states the opposite as fact — `/company/automations` says "Messages are
sent by the automation cron", `/company/broadcasts` says "Dispatched by the scheduled
job", and `/company/channels:34` says "New unread mail is answered on the next poll."

**Fix.** Two parts. (a) Commit a `vercel.json` with the four cron entries so a deploy
schedules itself. (b) Record `last_run_at` per job and show a red banner on the four
affected screens when it is null or stale: *"Scheduled sending is not switched on for
this account — nothing will send until it is."* A feature that depends on invisible
infrastructure must say so on the screen that depends on it.

### 1.3 Most of what shipped has no entry point

**Trying to do:** find the features.
**What happens:** they are not in the menu.

The live sidebar is `src/app/(dashboard)/layout.tsx:45-58` — twelve items, none of which
is Channels, Flows, WhatsApp, Broadcasts, Automations, Reports, Campaigns, Catalog,
Intents or Quality.

A rewritten navigation exists at `src/components/dashboard-nav-items.ts` — 227 lines with
a thoughtful de-jargoning pass ("Was 'Flows'. A flow is a diagram to us and nothing to an
owner" at `:140-141`). **It is untracked and nothing imports it.** Meanwhile
`src/app/(dashboard)/company/settings/page.tsx:24-28` has already been rewritten on the
assumption that the new sidebar landed — its comment says Channels, Broadcasts and
Catalog "now have their own sidebar rows", and it removed their tiles accordingly.

So the refactor half-landed: the old entry points were deleted, the new ones were never
connected. Current state:

| Page | Reachable today? |
|---|---|
| `/company/automations` | **No.** Zero inbound links |
| `/company/broadcasts` | **No.** Zero inbound links |
| `/company/campaigns` | **No.** Zero inbound links |
| `/company/reports` | **No.** Zero inbound links |
| `/company/flows` | Only from `/company/intents` and `/company/reports` — both unreachable |
| `/company/intents` | Only from `/company/flows` — unreachable |
| `/company/whatsapp` | Only from `/company/broadcasts` — unreachable |
| `/company/quality` | Only from `/company/evaluation`, whose settings tile was also removed |
| `/company/catalog` | One link, from an empty state on `/company/orders` |
| `/company/channels` | Yes, via Assistants → assistant → Settings → Channels (`bots/[id]/settings/page.tsx:61`) |
| `/company/sla`, `/developers`, `/billing`, `/usage` | Yes, via the Team & Settings hub |

The codebase already fixed this exact bug once, on the other side of the product —
`layout.tsx:28-30`: *"Reachable only by typed URL until now … an operator having to know
the URL was a real gap, not a cosmetic one."*

Also orphaned: the public Help Center at `/help/<publicBotId>`
(`src/app/help/[publicBotId]/page.tsx`). No screen in the dashboard ever shows the owner
its address.

**Fix.** Land the `dashboard-nav-items.ts` wiring. Then add the four it still omits —
`/company/sla` and `/company/developers` are covered by the Settings hub, but
`/company/profile`, `/company/evaluation` and the Help Center URL are not covered by
anything. Add a lint rule or a test that fails when a `page.tsx` under `(dashboard)` has
no inbound `href`.

### 1.4 New configuration is invisible to both the example file and the checker

**Trying to do:** deploy.
**What happens:** `npm run env:check` prints success while every new channel is broken.

`.env.example` contains 35 keys. It contains **none** of `CRON_SECRET`,
`META_VERIFY_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_VERIFY_TOKEN`,
`FACEBOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_APP_SECRET`,
`TIKTOK_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_API_URL`,
`EMAIL_API_KEY`.

`scripts/check-env.mjs:32-47` checks six required keys and five recommended ones. None of
the above is in either list.

Two of these fail **open**, which makes this a security finding rather than a
configuration one. `src/lib/channels/adapters/meta.ts:39-41` and
`src/app/api/webhooks/whatsapp/route.ts:37-38` both `return true` when the app secret is
unset — anyone who learns the webhook address can inject forged customer messages. The
Instagram route (`src/app/api/webhooks/instagram/route.ts`) and the Twilio route
(`src/app/api/webhooks/twilio/route.ts:32`) have no signature check at all.

**Fix.** Add every key to `.env.example` with a comment saying which feature it unlocks.
Add them to `check-env.mjs` as a third "needed for channels" tier. Change the signature
guards to fail closed in production — refuse the webhook rather than trusting it — and
log loudly at boot when a secret is absent.

### 1.5 The public SDK carries the competitor's brand

**Trying to do:** hand the API to a developer.
**What happens:** they receive a file named after a competitor.

`public/sdk/revora.js`, `public/sdk/revora.d.ts`, the global `Revora`, the class
`RevoraError`, the option type `RevoraOptions`, and the suggested environment variable
`REVORA_API_KEY`. The Developers page renders this to every customer:

- `src/app/(dashboard)/company/developers/page.tsx:48` — `<script src="…/sdk/revora.js">`
- `:51-52` — `const revora = new Revora({ apiKey: process.env.REVORA_API_KEY, … })`
- `:214-215` — the file paths, shown as copyable code

`docs/PUBLIC_API.md` and `scripts/test-public-api.mjs` carry it too. The file is served
anonymously — `src/middleware.ts` protects only `/dashboard`, `/super-admin` and
`/company`.

This is worse than embarrassing on a white-label product: an agency's client would find a
competitor's trademark inside their own integration code, published from their own
domain.

**Fix.** Rename to the platform's own name before anyone sees the Developers page. It is
a find-and-replace across seven files. Keep `revora.js` as a redirect only if a customer
has already integrated — unverified whether any has.

### 1.6 "Automatic top-up" is not automatic, and running dry is silent

**Trying to do:** never have the assistant stop.
**What happens:** it stops, without warning, and the safety net was never armed.

`src/lib/billing/auto-topup.ts:26-28` documents it plainly: *"Nothing calls it implicitly
— the company billing page exposes a manual 'Top up now'."* Confirmed: the only caller of
`maybeAutoTopUp()` in the repository is `src/modules/company/auto-topup-actions.ts:92`,
behind a button. It is not called from the credit-spend path
(`src/lib/billing/credits.ts`) and there is no billing cron.

The form claims otherwise — `src/modules/company/components/auto-topup-form.tsx:113-115`:
*"Runs the same check the platform runs."* The platform runs no check.

Around the same feature:

- The card id must be pasted by hand. `auto-topup-form.tsx:88-98` asks for the `pm_…` id
  "of a card saved on your Stripe customer". No SetupIntent, no Billing Portal link. A
  shop owner cannot do this.
- **Likely bug, unverified at runtime.** `auto-topup-form.tsx:74` gives the visible input
  `id="topupAmountCents"` while `:104` gives a hidden input the same `name`.
  `form.elements.namedItem()` matches both, returning a `RadioNodeList`, so the assignment
  at `:83` is a no-op — the typed amount is discarded and the old value submits.
- When credit hits zero, `src/app/api/chat/route.ts:274-286` tells visitors the assistant
  is "temporarily unavailable. A team member will follow up." No team member is notified.
  `low_balance_threshold` exists in the schema and is set to `2`
  (`src/modules/super-admin/actions.ts:163`) but is read only on a super-admin screen.
- The Arabic version of that same message is mojibake —
  `src/app/api/chat/route.ts:280`, byte-verified as double-encoded UTF-8 (`C3 98 C2 B9…`,
  rendering as `Ø¹Ø°Ø±Ø§Ù‹`). The AI-budget message fourteen lines above is correct Arabic,
  so this is a regression. It is the only mojibake string in `src/`. Arabic visitors see
  garbage at the exact moment the bot dies.
- The credit balance appears nowhere except as a hint under a form field
  (`auto-topup-form.tsx:57`), with no currency symbol. `/company/usage` does not show it.

**Fix.** Call `maybeAutoTopUp` from `deductAiCreditForUsage`, or add a billing cron. Add
a Stripe Billing Portal link instead of the `pm_…` field. Email the owner at the
threshold. Put the balance on `/company/usage` and in the Billing header. Repair the
Arabic string.

### 1.7 WhatsApp and Instagram run on the old code path

**Trying to do:** the two headline channels.
**What happens:** both are quietly degraded.

There are two inbound stacks. The new adapter stack serves telegram, viber, line,
facebook, tiktok and youtube (`src/lib/channels/webhook-route.ts:16-23`). WhatsApp,
Instagram and email keep dedicated static routes, and Next.js static segments win, so
`whatsappAdapter.parse` and `instagramAdapter.parse` are dead code for real traffic.

Consequences:

- `src/app/api/webhooks/whatsapp/route.ts:95` — `if (message.type !== 'text') continue;`
  Photos, documents, list selections and button taps are silently dropped. A customer who
  taps a button the assistant itself sent gets no reply. Outbound uses
  `sendWhatsAppText` (`src/lib/channels/whatsapp.ts:73-98`), plain text only, so the rich
  message types the adapter supports never ship.
- `src/app/api/webhooks/instagram/route.ts:38-40` reads only `entry.messaging`. There is
  no `entry.changes` loop, so **Instagram comments never arrive** — while
  `channels-data.ts:8` lists Instagram as a comment channel and the UI offers comment
  settings for it. The setting is inert.

**Fix.** Move WhatsApp and Instagram onto the adapter stack — the adapters are already
written and tested. That is one deletion and one route change, and it recovers rich
messages, button taps and Instagram comments at once.

### 1.8 "Sync from Meta" overwrites the user's template body

`src/modules/company/whatsapp-actions.ts:198-211` upserts on
`(company_id, name, language)` — the same key used when a user creates a template locally
at `:117` — and writes `body: '(managed in Meta)'`. Clicking **Sync from Meta** replaces
the user's own wording with that literal string and nulls their header, footer and
buttons. It is rendered straight back at
`src/app/(dashboard)/company/whatsapp/templates/page.tsx:113`.

Sync failures are also silent: `whatsapp-actions.ts:180-190` returns `void` and only
`logger.warn`s. The user clicks, nothing happens, no message.

**Fix.** Only overwrite rows whose origin is Meta. Add an `origin` column, or merge rather
than replace — take status and rejection reason from Meta, keep body and components local.
Return an `ActionState` from the sync action so failures surface.

---

## 2. Silent failures

| What fails | Is the user told? | Where |
|---|---|---|
| A channel token is wrong at connect time | **No.** The form says "Channel connected." | `channel-form.tsx:151`. Only Telegram/Viber validate, via `registerWebhook` (`channels-actions.ts:137-138`) |
| A channel token expires later | **No.** No health column, no last-received timestamp | `listChannelIdentities` selects only `created_at` (`channels-data.ts:74`); `channel_identities` has no error or status column (`0044_channel_identities.sql:14-24`) |
| A provider rejects an outbound message | **No.** Logged server-side and counted as "skipped" | `src/lib/channels/http.ts:62-70`; `handler.ts:206` |
| A comment reply fails to post | **No — and it is recorded as sent** | `handler.ts:193` writes `replied: true` unconditionally |
| YouTube's token expires (~1 hour, no refresh) | **No.** Looks identical to "no new comments" | `pollers/youtube.ts:45-56`; `adapters/youtube.ts:98` returns `[]` |
| A flow is saved but never published | Barely. A grey "Draft" badge | `flow-builder.tsx:754-756`. No sentence says it is not answering customers |
| A flow is published with no trigger | Only on the list page, not in the editor | `flows/page.tsx:103-105`. `validateGraph` does not check for a trigger, so publish succeeds |
| A whole broadcast fails | A red badge, no reason | `cron/broadcasts/route.ts:88-93` writes `error`; `broadcasts-data.ts:25-27` never selects it |
| A broadcast reaches zero recipients | **No.** Marked "sent" with count 0 | `cron/broadcasts/route.ts:193-200` |
| An automation run is claimed then crashes | **No.** Stuck as "pending" forever | `automations.ts:190-206` stamps `sent_at` before the outcome; the claim query at `:238` filters `.is('sent_at', null)` and can never re-claim it. No reaper |
| Credit runs out | **No.** See §1.6 | |
| The app secret is unset (forged webhooks accepted) | **No.** See §1.4 | |

The one honest error path in the batch is Telegram/Viber webhook registration
(`channels-actions.ts:157-178`), which surfaces the failure including the HTTPS
requirement. It is the model the rest should follow.

**The pattern.** Every one of these is a `catch` that returns a neutral value. That is
correct for keeping the bot answering, and wrong for keeping the owner informed. The
missing half is a per-company health record: a `channel_health` row with
`last_success_at`, `last_error`, `last_error_at`, surfaced as a badge on
`/company/channels` and as a notification the first time a working channel breaks.

---

## 3. Jargon

Every string below renders to a shop owner. The full list runs to ~120 strings; these are
the ones that stop someone completing a task.

### Channel setup — `src/lib/channels/registry.ts` and `channel-form.tsx`

| Current | file:line | Suggested |
|---|---|---|
| "Phone number id from WhatsApp Cloud API" | `registry.ts:56` | "The long number Meta shows under WhatsApp → API setup" |
| "Permanent access token" | `registry.ts:57` | "Access password from Meta (the permanent one, not the 24-hour test one)" |
| "Instagram professional account id" | `registry.ts:65` | "Your Instagram business account number" |
| "Page access token" | `registry.ts:66`, `:75` | "Access password for your Facebook Page" |
| "Subscribe to the messages, messaging_postbacks and feed fields." | `registry.ts:81` | "Your developer must tick three boxes in Meta: messages, button taps, and post comments." |
| "Bot id — the digits before \":\" in the BotFather token" | `registry.ts:86` | "The numbers before the colon in the code BotFather gave you" |
| "Any stable id for this Public Account" | `registry.ts:96` | "A short name for this account — anything, as long as you don't change it" |
| "Bot user id (the \"destination\" LINE sends, starts with U)" | `registry.ts:106` | "Your LINE bot's user ID — it starts with U" |
| "Creator open id of the connected TikTok account" | `registry.ts:116` | "Your TikTok account ID" |
| "Not required for inbound-parse" | `registry.ts:137` | "Not needed" |
| "Forward mail here, or connect Gmail with one click" | `registry.ts:141` | **Factually wrong.** Plain forwarding never reaches this address; it needs an inbound-parse provider. Say: "Use the one-click Gmail button below, or ask a developer to set up mail forwarding through Mailgun or SendGrid." |
| "Optional. Shown in this list instead of the raw provider id." | `channel-form.tsx:96` | "A name you'll recognise, like 'Shop WhatsApp'" |
| "Replace `<your id>` with the id above — this provider does not name the receiving account in its payload." | `channel-form.tsx:143-146` | "Swap `<your id>` for the ID you typed above." |
| "Meta channels verify with the `META_VERIFY_TOKEN` value; YouTube uses PubSubHubbub and needs no token." | `channels/page.tsx:96-99` | Remove. Show the actual verify token value instead, and say nothing about PubSubHubbub |
| "Page-scoped user id (PSID) of someone who has messaged your Page." | `channel-row-tools.tsx:25` | See below — the whole test flow needs rethinking |

**The test-message flow is unusable as designed.** `channel-row-tools.tsx:21-31` asks for
an "Instagram-scoped user id", a "PSID", a "Telegram chat id", or "a comment id". A shop
owner has none of these and no way to obtain one. The test only proves outbound works —
nothing ever tests that the provider can reach the webhook, which is the step that
actually fails. **Fix:** replace with "Send a test to my own number/account", pre-filled
from the last inbound conversation on that channel, plus a separate "Check my webhook"
that pings the provider's own status endpoint.

### WhatsApp suite

| Current | file:line | Suggested |
|---|---|---|
| "WhatsApp Business Account (WABA) id" | `whatsapp-settings-forms.tsx:31` | "Your WhatsApp business account number" |
| "Commerce catalog id" | `whatsapp-settings-forms.tsx:56` | "Your Meta catalogue number" |
| Raw `GREEN` / `YELLOW` / `RED` / `UNKNOWN` | `whatsapp/page.tsx:105` | "Good" / "Needs attention" / "At risk" / "Not reported yet" |
| Raw `PENDING_REVIEW`, `DECLINED` | `whatsapp/page.tsx:115` | "Meta is still reviewing your display name" / "Meta rejected your display name" |
| "Move beyond TIER_50 by sending consistent, high-quality traffic." | `whatsapp-guides.ts:63` | "You start limited to 50 new customers a day. Send good messages and Meta raises it." |
| "Migrate a live number from another BSP" | `whatsapp-guides.ts:89` | "Move a number from another WhatsApp provider (Twilio, 360dialog, Wati, Gupshup)" |
| "Lowercase and underscores — anything else is normalised." | `whatsapp-template-form.tsx:42` | "Lowercase letters and underscores only, e.g. `order_shipped`" |
| "Use `{{1}}`, `{{2}}` for values filled in at send time." | `whatsapp-template-form.tsx:74` | "Write `{{1}}` where a name or number goes. You fill those in when you send." |
| "Kept as the fallback text for contacts still inside the 24h window." | `broadcast-form.tsx:145` | "Used for people who messaged you in the last 24 hours." |
| "Inbound STOP / ايقاف messages are recorded automatically." | `subscribers/page.tsx:42` | "If someone replies STOP, we record it here automatically." |
| Set-up guide shows `https://your-app-domain` | `whatsapp-setup-guide.tsx:32, 63, 91` | **Bug.** The app knows its real URL (`automations-data.ts:139` uses it). Interpolate it |

### Flows and SLA

| Current | file:line | Suggested |
|---|---|---|
| "Drag blocks onto the canvas and connect them" | `flows/[id]/page.tsx:37` | **Factually wrong** — the palette is click-to-add (`flow-builder.tsx:835-853`). "Click a block to add it, then drag from the dot on its edge to connect" |
| "Ready to publish" badge | `flow-builder.tsx:765` | Shown even when the flow is already live. Hide it when status is `live` |
| "Intents & NLU" | `flows/page.tsx:52` | "What customers mean" |
| "Custom event" trigger | `flow-graph.ts:576` | Nothing can fire it (§5.2). Hide it or mark it unavailable |
| "The Succeeded / Failed handles branch on the HTTP status." | `flow-inspector.tsx:616` | "If the request works we follow the top arrow, otherwise the bottom one." |
| "Ref parameter (m.me/you?ref=…)" | `flow-triggers-panel.tsx:34` | "The tag on your link — the part after `ref=`" |
| "Attainment (30 days)" | `sla/page.tsx:73` | "Targets met (last 30 days)" |
| "Breaches" | `sla/page.tsx:84` | "Missed targets" |
| "Warn before breach (minutes)" | `sla-policy-form.tsx:112` | "Warn me this many minutes early" |
| "Rule order" / "Higher wins when two policies both match." | `sla-policy-form.tsx:151-153` | "Priority — if two rules fit, the higher number is used" |
| "Blocks entered" column | `reports/page.tsx:180` | Mislabelled *and* miscalculated — see §5.1 |

### Platform

| Current | file:line | Suggested |
|---|---|---|
| "Stripe payment method" / "The pm_… id of a card saved on your Stripe customer." | `auto-topup-form.tsx:88-90` | Replace the field with a Stripe Billing Portal link |
| "Top up below (credits)" | `auto-topup-form.tsx:55` | "Credits" is never defined anywhere. Show "£" and a plain-English explanation of what a credit buys |
| "full reference in `docs/PUBLIC_API.md`" | `developers/page.tsx:216` | That file ships only in the git repo — a customer cannot open it. Publish it, or inline it |
| "sub-account" throughout | `agency/page.tsx:47, 58, 63, 82, 95, 101` | "client account" |
| "Webhooks & automations" | `webhooks/page.tsx:67` | Collides with store automations. Rename to "Send data to other apps" |
| `'nav.company.webhooks': 'الويب هوك'` | `src/lib/i18n/ar.ts` | A transliteration, not a translation |
| "WhatsApp, Instagram, email, and SMS." | `src/lib/i18n/en.ts:225` | **There is no SMS channel** (`types.ts:10-20`), and it omits six that exist |

---

## 4. Inconsistencies

**Two SLA systems.** `/company/sla` writes `sla_policies` and `sla_states`
(`src/modules/company/sla-actions.ts:79-137`). The Inbox — where an agent actually works
— reads `support.slaResponseMinutes`, a single number from `company_settings`
(`inbox/page.tsx:233`, `support-settings-data.ts:123`). Grep confirms `sla_states` is read
only by `src/lib/sla/*` and the SLA page. The new system is invisible where it matters.
Both appear as adjacent tiles in the Settings hub: "Reply-time targets" and "Inbox rules".

**Three places to reason about business hours.** The schedule lives in
`company_business_hours`, edited on `/company/business-data`
(`business-profile-actions.ts:186-214`). An "Enable business hours (pauses SLA tracking
when closed)" checkbox lives on `/company/support-settings`
(`support-settings-form.tsx:107-110`) and writes `company_settings` — which
`src/lib/sla/` never reads. The only thing that actually gates the maths is the per-policy
`business_hours_only` column, set on a third screen. The checkbox's label is false.

**The business-hours maths is timezone-blind.** `src/lib/sla/schedule.ts:63-73` states
its precondition: *"callers pass a `from` already shifted into that timezone."* Neither
caller does — `src/lib/sla/index.ts:148` uses `params.at ?? new Date()` raw, and
`grep timezone src/lib/sla/` returns only comments. A 9-to-5 policy for a UTC+4 company is
evaluated against 9-to-5 UTC.

**"Automations" means two things.** `/company/automations` is store automations.
`/company/webhooks` is titled "Webhooks & automations" and `help-desk/page.tsx:826` links
to it labelled "Manage automations". An owner hunting for order messages lands on the
webhook page and concludes the feature does not exist.

**"Catalog" means two things.** `/company/catalog` is a read-only mirror of synced
products whose own empty state says it cannot do anything
(`catalog/page.tsx:17`). The real WhatsApp catalogue mapping — Meta catalogue id, retailer
ids — is on `/company/whatsapp:160-194`.

**Flow numbers disagree with themselves.** The flow editor's history panel counts every
`flow_sessions` row ever (`flows-data.ts:228-254`); Reports counts `flow_node_events`
within a window (`reports-data.ts:158-164`). Same words, different numbers.

**Cron auth differs.** `/api/cron` accepts `SUPABASE_SERVICE_ROLE_KEY`
(`src/app/api/cron/route.ts:18`); the four new ones want `CRON_SECRET`, and
`/api/cron/channels` accepts either (`:21`).

**Webhook events: docs say 8, the form offers 5.**
`supabase/migrations/0056_public_api.sql:83-90` and `docs/PUBLIC_API.md:355-364` advertise
`contact.created`, `message.sent` and `broadcast.created`. The API fires them. But
`webhook-form.tsx:14-20` offers five checkboxes and `webhooks-actions.ts:47` strips
anything else server-side, so no endpoint can ever subscribe. The Developers page shows
all eight with a **Send test** button that always answers *"No active endpoint is
subscribed … Add one above first"* (`src/lib/api/developer-events.ts:113`), pointing at a
form that structurally cannot comply.

---

## 5. Wrong numbers and dead controls

### 5.1 The flow completion rate is arithmetically wrong

`reports-data.ts:158-164` counts one `starts` per **node entered**, then computes
`completionRate = completions / starts` (`:189`). A ten-block flow completed perfectly by
one customer reports 10 starts, 1 completion, **10%**. The column header says "Blocks
entered" — so the numerator and denominator are not the same unit. Every flow will look
broken.

**Fix.** Count `starts` from the `start` node's events only, or from distinct
`conversation_id`.

### 5.2 Controls that do nothing

| Control | Evidence |
|---|---|
| "Let the assistant send product cards" | `whatsapp-settings-forms.tsx:70` saves a flag (`whatsapp-actions.ts:324`) no code reads. `whatsapp-catalog.ts` is called only by `scripts/test-whatsapp-suite.mjs` |
| Groups (both kinds) | `src/lib/groups.ts` exports three helpers; **no file imports them**. Broadcast audiences have no group option (`broadcast-audience.ts:59-70`). SLA reads `appliesGroupId` (`sla/index.ts:38`) but no form sets it. The page promises "Route tickets…" and "Target broadcasts…" (`groups/page.tsx:83-84`) |
| "Custom event" flow trigger | `matchTrigger` needs `ctx.eventName` (`triggers.ts:188-192`); neither caller supplies it (`api/chat/route.ts:215-223`, `ai/inbound.ts:87-97`) |
| Auto top-up threshold | §1.6 |
| "Enable business hours" on Inbox rules | §4 |
| `random` flow block | Creatable, but the inspector renders a paragraph instead of settings (`flow-inspector.tsx:643-649`). Fixed at two outputs, no weights |
| Gallery card buttons | Modelled (`types.ts:60`) and executed (`engine.ts:328`), not editable |

### 5.3 Broken links

- `sla/page.tsx:188` links to `/company/inbox?conversation=<id>`. The inbox reads only
  `status`, `q` and `page` (`inbox/page.tsx:92`). Should be `/company/inbox/<id>`.
- `sla/page.tsx:94` — "At risk right now" links to an unfiltered inbox.
- `automation-templates.ts:325-334` falls back to `${appUrl}/?recover_cart=<id>`. Nothing
  in `src/` reads `recover_cart`. Every non-Shopify recovery link goes to the homepage and
  does nothing.

---

## 6. Missing prerequisites the UI does not state

| Feature | Silent requirement |
|---|---|
| Any Meta channel | App Review for `pages_messaging` / `instagram_manage_messages` / `whatsapp_business_messaging` — weeks. Never mentioned |
| WhatsApp | A phone number **not already in the WhatsApp app**. Stated in the guide (`whatsapp-setup-guide.tsx:48-50`), not in the form |
| Facebook / Instagram | `META_VERIFY_TOKEN`. Without it the handshake always 403s (`webhook-route.ts:76-83`) and the verify-token row simply does not render (`channels-data.ts:49-63`) — indistinguishable from a channel with no token concept |
| Any webhook channel | A public HTTPS URL. Surfaced only for Telegram/Viber, and only after saving (`channels-actions.ts:157-159`). On localhost the page offers a copy button for `http://localhost:3000/...` |
| Gmail | A Google OAuth app with `<app>/api/channels/gmail/callback` pre-registered, plus Google's verification for restricted scopes. Failure returns raw JSON, not a UI message (`gmail/start/route.ts:22-24`) |
| Email replies | `EMAIL_API_URL` / `EMAIL_API_KEY`. Without them `email.ts:24` returns `false` immediately — inbound works, nothing can ever reply |
| Templates / broadcasts | A WABA id. Partly stated (`whatsapp-template-form.tsx:99`) |
| Shopify / Woo | The exact topic list, which exists only in code (`automation-templates.ts:235-256`). The UI says "the order, fulfilment, cancellation and checkout topics" in prose |
| Shopify HMAC | A single platform-wide `SHOPIFY_WEBHOOK_SECRET` (`route.ts:51-54`). Shopify issues a different secret per store, so a manually-created webhook in each tenant's own admin cannot validate against one shared secret. The UI shows no secret at all. Needs a product decision, not just a doc fix |
| Everything time-based | Four unscheduled cron jobs (§1.2) |
| Telegram / TikTok / YouTube saves | Migration `0052` widens the channel CHECK constraint. Unapplied, the user sees a raw Postgres error (`channels-actions.ts:131`) |

---

## 7. Claimed vs. actual — the parity list

| Claim | Verdict | Evidence |
|---|---|---|
| WhatsApp | **Partial.** Text-only inbound and outbound on the live path | `webhooks/whatsapp/route.ts:95` |
| Facebook Messenger + feed comments | **Real.** The best-wired channel | `adapters/meta.ts:67-150`, `:248-266` |
| Instagram DM | **Real** (text only) | `webhooks/instagram/route.ts:36-65` |
| Instagram comments | **Missing.** Never parsed, though the UI configures it | `webhooks/instagram/route.ts:38-40` |
| Telegram | **Real.** Richest implementation | `adapters/telegram.ts:61-194` |
| Viber | **Real** | `adapters/viber.ts:42-132` |
| LINE | **Real**, but the send token is stored in plaintext | `adapters/line.ts:43-157`; `channels-actions.ts:116` |
| TikTok | **Partial.** Comments only; "private DM" silently posts publicly | `adapters/tiktok.ts:65-123`; `handler.ts:184-186` |
| YouTube | **Broken in practice.** Webhook parse returns `[]`; poller token expires hourly with no refresh | `adapters/youtube.ts:24-31`; `pollers/youtube.ts:45-56` |
| Email inbound | **Real** | `webhooks/email/route.ts:39-79` |
| Email outbound | **Partial.** No-op without two undocumented env vars | `channels/email.ts:24` |
| Gmail OAuth | **Real**, if the cron is scheduled | `pollers/gmail.ts:54-164`; `adapters/gmail.ts:39-202` |
| Flow builder, visual | **Real.** Hand-rolled pan/zoom/drag/connect, undo/redo, autosave, versioning | `flow-builder.tsx:319-548`, `:657-663` |
| All 21 block types | **Real.** All creatable and executable; `random` has no settings, gallery buttons not editable | `flow-graph.ts:132-174`; `flow-inspector.tsx:202-653`; `engine.ts:294-461` |
| All 7 trigger types | **6 real, 1 dead.** `event` can be configured but nothing fires it | `flow-triggers-panel.tsx:190-194`; `triggers.ts:188-192` |
| Flow testing | **Real, and good.** Runs the production engine in-browser on unsaved edits | `flow-simulator.tsx:8, 97-104` |
| WhatsApp templates | **Real.** Genuine Meta API create/delete/sync — with the overwrite bug | `whatsapp-templates.ts:176-255` |
| Opt-in / opt-out | **Partial.** Excellent keyword engine incl. Arabic normalisation, but hardcoded, not configurable, and ignored by store automations | `subscriptions.ts:25-83`; §1.1 |
| 24-hour service window | **Missing entirely.** Described in six places, enforced in none. Verified by grep: no `last_inbound` read anywhere | `cron/broadcasts/route.ts:221-236`; `automations.ts:301` |
| Catalog selling | **Half-built.** Correct Meta message builders, correct retailer-id mapping, zero callers | `whatsapp-catalog.ts:24-71` |
| Broadcasts + segmentation | **Real.** Five audience types, opt-out always wins. No rate limiting; tier is displayed but never consulted | `broadcast-audience.ts:49-85`; `cron/broadcasts/route.ts:221-236` |
| Blue-tick + BSP guides | **Real.** 154 lines of accurate content with persisted per-step progress. A checklist, not automation | `whatsapp-guides.ts:31-148`; `whatsapp/page.tsx:200-246` |
| Shopify automations | **Real**, incl. correct HMAC with constant-time compare | `store-signatures.ts:21-44`; `route.ts:384-394` |
| WooCommerce automations | **Partial.** Orders yes; **abandoned cart is Shopify-only** and nothing says so | `automation-templates.ts:276-278` |
| Abandoned cart | **Real** detection with atomic claim. Starter waits ~2h while claiming 1h | `abandoned-cart.ts:130-206`; `starter-rules.ts:63-70` |
| Unified inbox + ticketing + SLA | **Real inbox and ticketing. SLA is a second, disconnected system** | §4 |
| RBAC | **Thin but consistent.** Three roles, no permissions. New pages are all admin-only. `/company/help-desk` has no `requireRole` of its own — any agent can open it | `constants.ts:3-7`; `company/layout.tsx:10` |
| Groups | **Missing in effect.** CRUD only; no consumer | §5.2 |
| Agency / white-label | **Partial.** Branding is real. Not a reseller model — sub-accounts get free paid plans (`agency-actions.ts:116-124`) and **no user is ever created for them**, so nobody can log in. Super-admin creates agencies; no self-serve | `agency.ts:22-33`; `agencies-actions.ts:70` |
| Business hours | **Real, in the wrong place, timezone-blind** | §4 |
| Billing + auto top-up | **Stripe is real. Auto top-up is manual** | §1.6 |
| Reports | **Real data.** "Handled by AI" is inferred from current status, so it overstates automation (`reports-data.ts:37, 120-121`); completion rate is wrong | §5.1 |
| AI insights | **Missing.** Case-insensitive grep for "insight" across `src/` and `docs/` returns nothing. Nearest analogue is `/company/quality`, which is rules-based | |
| Public API | **Real, and the best thing here.** 9 routes, all documented, all exist. Key auth with constant-time compare, 8 scopes, distributed rate limiting, tenant isolation from the key, request logging | `api-keys.ts:119-202`; `api/handler.ts:159-218` |
| Outbound webhooks | **Real** — HMAC signing, one retry, user-visible delivery log — but 3 of 8 documented events are unsubscribable, and the signing secret is stored and displayed in plaintext | `webhooks.ts:161-175`; §4; `webhooks-data.ts:29` |
| JS SDK | **Real** — 265 lines UMD, typed, publicly served. **Branded as the competitor** | §1.5 |
| English + Arabic | **Customer-facing Arabic is real** — script and Arabizi detection (`ai/lang.ts:30-37`), RTL widget. **Dashboard Arabic is ~8%** — 221 keys, 4 of ~48 pages call the dictionary, and no component under `src/modules/` or `src/components/` uses it at all. "Auto-detect" silently means English (`i18n/index.ts:39`) | |

---

## 8. Smaller things worth a ticket

- **Every label in the Channels forms is unassociated.** `FormField htmlFor="…"` points at
  ids that do not exist — `Input`/`Select` receive `name` but never `id`
  (`src/components/ui/input.tsx:4-16`). Screen readers announce nothing.
- **LINE's send token is plaintext** in `settings_json` (`channels-actions.ts:116`) while
  the sibling secret is encrypted at `:125` — under a form hint that says "Stored
  encrypted". RLS grants `select` on `channel_identities` to all company members
  (`0044_channel_identities.sql`).
- **Encryption fails open.** `channels-actions.ts:50-57`, `identity.ts:33-39`,
  `pollers/gmail.ts:33-40`, `api/delivery.ts:74` all `catch { return value }`. In
  production a ciphertext is sent to the provider as a credential.
- **The webhook signing secret** is rendered in full on every page load
  (`webhooks/page.tsx:150`) with no rotate button.
- **No copy button on the store webhook URL** (`automations/page.tsx:237`) — the token URL
  must be hand-selected. `CopyButton` exists and is used elsewhere.
- **Flow analytics leak node ids** — `flow-builder.tsx:1167` renders `msg_3`, `btn_1`
  instead of block titles, though `nodeTitle()` is in the same file.
- **Order-status flow template ships a fake API key** — `flow-graph.ts:875` seeds
  `Authorization: Bearer YOUR_API_KEY` against `api.example.com`. Publishing it unchanged
  gives an always-failing branch that degrades to a handoff, so it "works" while doing
  nothing.
- **Opt-in/opt-out confirmations are hardcoded English** in a route handler
  (`webhooks/whatsapp/route.ts:111-112`), bypassing i18n. An Arabic customer sending
  `ايقاف` gets an English confirmation.
- **Hardcoded FX and currency** — `credits.ts:5-6` (`USD_TO_GBP = 0.8`, markup 2.5), and
  `'gbp'` / `'GBP'` literals in every charge and ledger write. No non-UK tenant.
- **The platform brand is a string literal** in two places (`agency.ts:49`,
  `layout.tsx:201`), not configuration — awkward for white-label.
- **Dev logs committed** — `tmp-next-dev.log`, `tmp-next-dev.err.log`,
  `tsconfig.tsbuildinfo` at the repo root.
- **Unverified:** whether the `rate_limit_hit` RPC exists in the migrations. If not, the
  API silently falls back to per-instance in-memory limiting
  (`ratelimit.ts:49-53`), which on serverless means effectively no rate limit.

---

## What I would do first

1. Fix the opt-out query (§1.1) and disable store automations on WhatsApp until it ships.
2. Commit `vercel.json`; add a "scheduled sending is off" banner (§1.2).
3. Land the navigation wiring (§1.3).
4. Rename the SDK (§1.5).
5. Add the missing env vars to `.env.example` and `check-env.mjs`; make signature checks
   fail closed (§1.4).
6. Move WhatsApp and Instagram onto the adapter stack (§1.7) — one change, recovers rich
   messages, button taps and Instagram comments together.
7. Add channel health (`last_success_at`, `last_error`) and a badge (§2).
8. Make auto top-up automatic, or rename it "Top up" (§1.6).
