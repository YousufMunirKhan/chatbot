# Making the dashboard make sense

The customer-facing dashboard grew to roughly forty screens in a few months.
Most of the newest ones were reachable only by typing the URL, the sidebar was
one flat list of twelve, and a lot of the wording was written for the people
building the product rather than the people paying for it.

The audience is a shop owner or a member of their staff. They are not
developers, many of them are not native English speakers, and the product also
ships in Arabic with the whole shell mirrored. Every decision below follows from
that.

---

## 1. The new information architecture

The sidebar is now seven groups, named after **jobs the owner recognises**, not
after our modules. The definition lives in `src/components/dashboard-nav-items.ts`;
`src/app/(dashboard)/layout.tsx` only decides which set to show and translates it.

| Section | Route | Label shown | Why it is here |
| --- | --- | --- | --- |
| **Start here** | `/company` | Home | What needs you today. |
| | `/company/setup` | Get set up | The ordered checklist. A verb, so it reads as something to do. |
| **Talk to customers** | `/company/inbox` | Inbox | The daily work. |
| | `/company/customers` | Customers | Rolls up enquiries, bookings and orders — see "one destination, one row" below. |
| | `/company/notifications` | Alerts | Shorter and plainer than "Notifications", and easier to translate. |
| | `/company/help-desk` | Staff help desk | Same job — answering someone — for your own team. Only shown to tenants that have an internal assistant. |
| **Teach your assistant** | `/company/bots` | My assistants | The possessive matters: it is *yours*, not a system object. |
| | `/company/business-data` | My business info | The most-visited configuration page in the product. Nobody thinks of their opening hours as "data". |
| | `/company/quick-actions` | Chat buttons | Says what it puts on the screen. |
| | `/company/flows` | Guided chats | A "flow" is a diagram to us and nothing to a shop owner. |
| | `/company/intents` | Trigger phrases | "Intents & NLU" was two pieces of jargon in one label. |
| | `/company/quality` | Improve answers | Named after what you do there. |
| **Where customers find you** | `/company/widget` | Website chat | "Widget" is our word. |
| | `/company/channels` | Messaging apps | In a shop, "channel" means a TV channel or a sales channel. |
| | `/company/whatsapp` | WhatsApp | Big enough, and different enough, to deserve its own row. |
| **Sell more** | `/company/catalog` | Products | What is actually in it. |
| | `/company/automations` | Automatic messages | Was "Store automations". |
| | `/company/broadcasts` | Bulk messages | A broadcast is radio; this is one message to many people. |
| | `/company/campaigns` | Chat invites | Was "Proactive campaigns" — nobody says "proactive". |
| **How it's going** | `/company/reports` | Reports | |
| | `/company/usage` | Usage & limits | The "limits" half is the bit people come looking for. |
| **Your account** | `/company/agents` | Team | |
| | `/company/billing` | Billing | |
| | `/company/settings` | All settings | The hub for everything below. |
| | `/company/agency` | Agency | Only for an operator who owns a reseller agency. |

**Behind "All settings"** — a directory with four sub-headings, so sixteen links
do not read as one undifferentiated grid:

| Sub-heading | Pages |
| --- | --- |
| People | Team, Groups |
| Plan and spending | Billing, Usage & limits, Spending cap (`/company/ai-controls`) |
| Connected apps | Connect your shop (`/company/integrations`), Set up for you (`/company/managed-connectors`), Send data elsewhere (`/company/webhooks`), For developers (`/company/developers`) |
| Service and safety | Reply-time targets (`/company/sla`), Inbox rules (`/company/support-settings`), Sign-in & security (`/company/security`) |

…plus the data-retention, privacy-request and export cards that were already on
that page.

### Rules the grouping follows

- **One destination, one row.** `/company/leads`, `/company/orders` and
  `/company/appointments` are the detail views behind the three sections of
  `/company/customers`, which links to each with a "Manage all". Giving them
  sidebar rows as well would have made the same data look like six features.
  `/company/knowledge`, `/company/evaluation` and `/company/profile` are pure
  `redirect()` stubs into `business-data` and `quality`, so they get no row
  either.
- **Two words where possible.** The sidebar is 224px inside its padding, and
  every label has to survive Arabic, which runs longer.
- **Nothing developer-only in the sidebar.** Webhooks, the API and the
  connectors moved behind the settings hub. A shop owner never needs to scroll
  past them.
- **The agent role is untouched.** Agents still get Inbox and Customers and
  nothing else.
- **The super-admin nav is untouched.** That audience is internal; renaming its
  labels would have cost operators their muscle memory for no gain.

### Why grouped-but-flat, not collapsible

`NavList` in `src/components/dashboard-nav.tsx` already rendered
`{group, items}[]` — the old code just passed it a single group. Using several
groups meant **zero changes to the nav component** and no client-side state: the
sidebar stays server-rendered and ships no JavaScript. Twenty-four rows across
seven headed groups is scannable; collapsing them would hide the map from the
person who most needs it.

---

## 2. Renames

### Sidebar and page titles

| Route | Was | Now |
| --- | --- | --- |
| `/company/setup` | Setup / "Setup journey" | Get set up |
| `/company/bots` | Assistants | My assistants |
| `/company/business-data` | Business Data | My business info |
| `/company/knowledge` | Knowledge | *(folded into My business info — it was already a redirect)* |
| `/company/quick-actions` | Quick Actions | Chat buttons |
| `/company/flows` | Flows | Guided chats |
| `/company/intents` | Intents & NLU | Trigger phrases |
| `/company/quality` | Quality / "Quality Room" | Improve answers |
| `/company/evaluation` | Evaluation | *(already redirected to Improve answers)* |
| `/company/widget` | Website Widget | Website chat |
| `/company/channels` | Channels | Messaging apps |
| `/company/whatsapp` | WhatsApp Business | WhatsApp |
| `/company/whatsapp/templates` | Message templates | Approved messages |
| `/company/whatsapp/subscribers` | Subscribers | Who you may message |
| `/company/catalog` | Catalog | Products |
| `/company/automations` | Store automations | Automatic messages |
| `/company/broadcasts` | Broadcasts | Bulk messages |
| `/company/campaigns` | Proactive campaigns | Chat invites |
| `/company/leads` | Leads | Enquiries |
| `/company/appointments` | Appointments | Bookings |
| `/company/notifications` | Notifications | Alerts |
| `/company/help-desk` | Internal Help Desk | Staff help desk |
| `/company/integrations` | Integrations & Sync | Connect your shop |
| `/company/managed-connectors` | Managed connectors | Set up for you |
| `/company/webhooks` | Webhooks & automations | Send data elsewhere |
| `/company/sla` | Service levels | Reply-time targets |
| `/company/security` | Security | Sign-in & security |
| `/company/settings` | Team & Settings | Settings |
| `/company/usage` | Usage | Usage & limits |

Routes are unchanged throughout — every old bookmark still works.

### Labels inside pages

Smaller but higher-traffic:

- **Orders**: "Chat orders" → *Ordered in chat*; "Synced orders" → *From your
  shop*; `dine_in` → *Eat in*; `fulfilled` → *Sent to the customer*;
  `wc-processing` → *Being prepared*. The status dropdown an owner uses every day
  listed raw lowercase enum values — it now lists the same words as the badge.
- **WhatsApp health**: `GREEN`/`YELLOW`/`RED` → *Good* / *At risk* / *Restricted
  by WhatsApp*; `TIER_1K` → *1,000 new customers a day*; `PENDING_REVIEW` →
  *Being reviewed by WhatsApp*. "Messaging limit" → *You can message first*,
  with a note that replies do not count against it.
- **Webhook deliveries**: the column headed `HTTP` containing a bare `401` is now
  *What they answered* → "Refused us (401)". Event ids (`lead.created`) show as
  *Someone left their details* in the tables and stay verbatim in the docs
  section, where the audience is the person wiring it up.
- **Integrations**: `provider.replace(/_/g,' ')` printed *woocommerce* and
  *custom api*; a `PROVIDER_LABELS` map gives *WooCommerce* and *Your own system*.
  "Resync" → *Refresh now*; "Sync jobs" → *Recent refreshes*.
- **Security**: `auth login_failed` → *A sign-in was refused — wrong password*.
  On a page whose entire job is reassurance, machine text read like a fault.
- **Improve answers**: "chunks", "embeddings", "Supabase" and "vector search"
  are gone from the customer-facing copy. The count of searchable passages is
  labelled as such, so nobody reads "312" as "312 files". Retrieval buckets
  (`faq`, `doc_chunk`) render as *a saved question*, *a file you uploaded*.
- **Usage**: "AI deflection rate" → *Handled without you*, and every percentage
  tile gained a hint saying what it is a percentage **of**.

Everything is backed by display-label maps in `src/lib/constants.ts` (added, not
changed — no stored value moved), each paired with `humanizeToken()` so an
unmapped value from Meta or Shopify degrades to readable English rather than to
`undefined`.

---

## 3. The first-run checklist

`/company` and `/company/setup` now answer the same question with the same data
and can never disagree — both read `getCompanySetupProgress()`.

**`/company/setup` — "Get set up"**

> Five things to do, in this order. Each one is saved as you finish it, so you
> can stop and come back whenever you like.

1. **Choose what it does** — who it talks to: your website visitors, or your own staff.
2. **Pick the jobs it handles** — tick only what you want it doing today.
3. **Add your business details** — import your website first, then fill the gaps.
4. **Try it yourself** — ask it what your customers ask, including something it cannot know.
5. **Put it on your website** — add your address, paste one line of code.

Then, separately and explicitly **not** numbered: *When you are ready for more* —
answer on WhatsApp too, send messages automatically, bring your team in. Putting
"connect a channel" in the checklist would make a finished set-up look unfinished
forever; a website assistant with no WhatsApp is a complete product.

The page used to open with a readiness **percentage**, a progress bar, four
counters (`Assistants 1`, `Knowledge docs 3`…) and then an interactive wizard
listing the same five steps a second time. All of that is replaced by one
server-rendered `<ol>` with exactly one primary button on it — the next thing to
do. Finished steps stay visible and re-openable, because "what did I already set
up?" is the second question people ask. The header now says **"3 of 5 done"**: a
position in a list you can see, not a mark out of a hundred.

`/company` keeps its four-state machine (no assistant → in progress → live but
quiet → live and busy) because it was already the best thing on the dashboard.
It gained one line of orientation under the company name and a "See the whole
checklist" link, so the single next step on Home has a visible path to the list
it came from.

---

## 4. Empty states

Every list page now says, in one sentence, what the feature does for the shop,
and offers one button to the next step. The ones that had a bare title and
nothing else:

| Page | Now says |
| --- | --- |
| Saved replies | "Think of the three things you type most — your address, your delivery times, how to return something." |
| Set up for you | "Connect Shopify, Square or Foodics above and the assistant starts answering from your live stock and sales straight away." |
| Sign-in & security | "Sign-ins, password changes, and any refused attempt on your account will be listed here." |
| Send data elsewhere (both tables) | What a destination is for; what the log will contain when something fails. |
| My assistants | "An assistant answers your customers on your website and on WhatsApp, day and night… Most shops only ever need one." |
| Website chat | "The chat on your website is the front of an assistant, so there has to be one to put there." |
| Chat buttons | "Right now a visitor opens the chat and sees an empty box with nothing to tap, and most of them close it again." |
| Privacy requests | What lands there and when. |

Log-style empty states (refreshes, deliveries, automation runs) deliberately get
an explanation and **no button** — there is no action to take; something has to
happen first.

---

## 5. Field help

Used the existing `FormField` `hint` prop everywhere, and nothing new:

- **Reply-time targets** — every field. "Answer within (minutes)" now explains
  that the clock starts when a chat needs a *person*, and that 15 means a quarter
  of an hour; "Finish within" says 1440 is a day. These are the numbers people
  get wrong by an order of magnitude.
- **Send data elsewhere** — the URL field tells a Slack user exactly which menu
  produces the address, and tells everyone else that the receiving system
  provides it.
- **Messaging apps** — "Which app", "Which assistant answers here", and a
  restated explanation of the two halves of connecting one (where their messages
  go; how we send replies). The `META_VERIFY_TOKEN` environment-variable name is
  gone from the prose; the page now points at the verify token shown next to each
  connected app instead.

No tooltips were added. Nothing essential is behind a hover.

---

## 6. Deliberately not changed

- **`/company` home's four-state machine.** It already answered "what do I do
  next" better than anything else in the product. Only the header line and one
  link were added.
- **The super-admin navigation and every super-admin page.** Different audience,
  and the brief is the customer-facing dashboard.
- **`/company/developers`.** Another agent is actively building it. Its raw
  `JSON.stringify` payload sample, bare HTTP status badges, `POST /api/v1/…`
  request column and unmapped `conversations:read` scope badges are all still
  there. Note for whoever owns it: **`API_SCOPE_LABELS` already exists in
  `src/lib/api-keys.ts` and is used in the create form but not in the key table**
  — that one is a two-line fix.
- **`/company/flows`, `flow-builder.tsx`, `flow-create.tsx`** — owned by another
  agent. The nav label and the page title were changed to "Guided chats"; the
  builder itself was not touched.
- **Routes.** Not one URL moved. Renaming a route would break every bookmark and
  every deep link in existing emails for a cosmetic gain.
- **`setup-data.ts`'s five steps.** The step definitions, their completion rules
  and their hrefs are unchanged — this was a presentation change, so Home and
  Get set up could not drift apart.
- **The Arabic wording of pages I did not touch.** New dictionary keys were added
  in both languages; existing Arabic values were only changed where the English
  label they translate changed meaning.

## 7. Known problems left behind

Worth someone's time, out of scope here:

- **`/company/sla` and `/company/support-settings` overlap.** Both set
  response-time expectations, from two different modules. They are filed together
  under "Service and safety" so at least they are found together, but they should
  probably be one page.
- **`/company/customers` duplicates `/company/leads`, `/orders`, `/appointments`.**
  The roll-up shows eight rows of each and links out. It works, but it is four
  screens for what could be one page with tabs.
- **`/company/inbox/[id]` has no `PageHeader`** — the only real page in the
  dashboard without one.
- **`/company/reports`** prints a raw ISO date (`2026-08-08`) where every other
  page in the product uses `formatDate`.
- **Six `settings.section.*` dictionary keys are now unused** (quick-actions,
  quality, channels, broadcasts, campaigns, catalog) because those pages moved
  into the sidebar. Harmless, and left in place rather than risking a conflict
  with the translation work happening in the same files.

---

# Part two — the desktop pass

Part one above was written from a phone. Everything below was written from a
1280–1920px screen, where the product has a different set of problems: the
dashboard was a single narrow column with a third of the window empty, and a lot
of controls were still labelled for the person who built them.

Three things changed: the board at `/company`, the desktop layout of eighteen
pages, and the wording of about two hundred controls.

---

## 8. The board — `/company`

### What it shows now

`/company` was already a four-state machine (no assistant → setting up → live
but quiet → live and busy) and that stays, because a tenant with no assistant
and a tenant with a full inbox need different pages, not the same page with
different numbers in it. What changed is the fourth state, which is the one an
owner opens every morning. It now answers three questions in this order and no
other.

#### 1. What needs me right now?

Four queues, each a real to-do list with a count and a direct link:

| Signal | Where it comes from | Why it earns its place |
| --- | --- | --- |
| **Chats past your reply-time target** | `sla_states` where the first-response target was breached, no reply has been sent, and the chat is not resolved | Somebody is waiting *and* you have already broken a promise you set yourself. Nothing else on the page outranks it. |
| **People waiting for you in chat** | `conversations` in `needs_human` / `human_active` | The assistant gave up. Until a person replies, the customer is stuck. |
| **Enquiries nobody has contacted** | `leads` with status `new` | Somebody typed their phone number in and is waiting for a call. Deliberately **not** windowed to seven days — an enquiry from three weeks ago that was never answered is more urgent, not less. |
| **Automatic messages that did not send** | `automation_runs` with status `failed` in the last 7 days | The single most invisible failure in the product. The owner believes every abandoned basket got a nudge and nothing anywhere says otherwise. |

The data layer returns these already filtered to non-empty queues and sorted
worst-first, so **the page cannot render a row of zeroes**. The most urgent one
gets the page's single solid button; the rest are whole-tile links carrying their
own count. If every queue is empty the section collapses into one sentence and a
quiet link to the inbox — there is nothing to push, so nothing pushes.

Two of these four are also the answer to "a tile that always reads 0 because the
feature is not switched on is worse than no tile": a company with no reply-time
target has no `sla_states` rows at all, and a company with no automatic messages
has no `automation_runs`, so those tiles simply never render for them. Nobody is
shown a permanent zero for something they have not turned on.

#### 2. How is it going?

Four trailing-7-day numbers, on the shared `StatTile` — the local `Stat` clone
this page used to carry is exactly what that component was extracted to replace.

| Tile | Counts | Hint |
| --- | --- | --- |
| Chats this week | conversations started in the window | "People who opened the chat on your website or apps" |
| Answered on its own | conversations that never reached a human | "Finished without ever needing a person" |
| New customer requests | leads + booking requests + chat orders | "Enquiries, booking requests and orders taken in chat" |
| Customer rating | mean `conversations.csat_rating` in the window | "From N ratings this week" |

Each hint runs two lines: what the number counts, then the week-over-week
comparison. The first line is not decoration — **"New customer requests" is three
different things added together** and without the hint nobody can tell which. It
was labelled "New enquiries", which was simply wrong: it includes bookings and
orders too.

The rating tile is the one that can have no number. If nobody rated a chat this
week it says so; if the star rating was never switched on it says *that* instead
and links straight at the switch, because those are different problems and only
the second one is the owner's to fix. It never shows an em dash.

Nothing cumulative survived. A lifetime total that only ever grows cannot tell an
owner whether to open the inbox today.

#### 3. What should I set up next?

Rendered only while `setup.complete < setup.total`. A finished checklist removes
the section rather than showing "5 of 5" forever. It sits in the right-hand
column because it is standing work, not today's work, and must not outrank the
queue on the left.

### What it deliberately does not show

- No status badge in the header, no readiness percentage, no plan or billing
  chrome — those live on their own screens.
- No metric that is not either a queue or a real count from the last seven days.
- No more than one solid-variant button per state. In the busy state that button
  is the most urgent queue.

### Data-layer notes

`getCompanyDashboardSummary()` gained `attention`, `csat7d` and four new bounded
count queries. The three that depend on an optional feature's table
(`sla_states`, `automation_runs`, `conversations.csat_rated_at`) run through an
`optional()` wrapper: a missing migration degrades that one signal to "nothing to
report" instead of 500-ing the one page every owner opens first.

CSAT is read from `conversations.csat_rating`, which is what the widget's rating
endpoint actually writes. `conversation_ratings` — the older table the 30-day
report still reads — was deliberately not used here, because mixing the two would
let Home and Reports disagree about the same week. That divergence is logged in
section 11.

Thirty-one new dictionary keys were added to `en.ts` and `ar.ts` together; key
parity is checked by `scripts/test-platform-features.mjs`, which still passes at
285 keys.

---

## 9. Desktop layout

### The shell imposes no width

`src/app/(dashboard)/layout.tsx` gives a 256px sidebar and 24px of padding and
**no `max-width` at all**. Every cap is the page's own, and
`mx-auto max-w-6xl space-y-6` was hand-copied into 41 of the 45 non-redirect
pages. At 1920px that leaves 464px — 29% of the window — permanently empty while
nine-column tables scroll inside their own cards.

### Widths

| Change | Pages |
| --- | --- |
| `max-w-6xl` → **`max-w-7xl`** (tables, lists, dashboards of numbers) | reports, help-desk, business-data, developers, webhooks, customers, quality, integrations, orders, catalog, appointments, bots, usage, notifications, agents, automations, sla, whatsapp, whatsapp/subscribers, quick-actions/analytics |
| `max-w-4xl`/`5xl` → **`max-w-6xl`** (content was wider than its cap) | insights, groups, intents |
| `max-w-6xl` → **`max-w-3xl`** (a single form of short fields) | bots/new, support-settings, ai-controls |
| `max-w-4xl` → **`max-w-6xl`, busy state only** | `/company` home — states A, B and C1 are a paragraph and a button and stay narrow |
| unchanged | setup (checklist + prose — narrow is correct), flows/[id] (deliberately full-bleed canvas) |

`max-w-7xl` is 1280px. At 1280 and 1440 viewports it does not bind at all — the
sidebar already takes the difference — so this is purely a 1536px-and-up change,
which is where the waste was. It is not "make everything full width": a
1600px-wide table row is harder to read across, not easier. `usage`, which is
nothing but tiles, also gained a fifth column at `xl`.

### Two-column arrangements

Every one of these was a form card stacked directly on top of the list that form
creates, so the owner scrolled past the form every single time to reach the list
they came to check — and then could no longer see what they were copying.

| Page | Left column (wide) | Right column (narrow, sticky) |
| --- | --- | --- |
| `business-data` — Services, Policies, FAQs, Knowledge tabs | what you already have | the form that adds another |
| `business-data` — Basics & hours | four independent forms, two-up at `xl` | — |
| `agents` | everyone who can sign in; invitations sent | invite someone; am I at my desk |
| `sla` | your targets; chats that went past their target | add a target |
| `automations` | your automatic messages; recently sent | the editor; shop-webhook setup |
| `developers` | your keys; webhook events; recent API requests | create a key; quick start |
| `integrations` | what you have connected; recent refreshes | connect an integration; import from CSV |
| `flows` | the guided chats you have | start from a template; start from nothing |
| `broadcasts` | what you have sent | the composer |
| `campaigns` | your chat invites | the composer |
| `managed-connectors` | what is connected | connect one |
| `inbox/canned` | the replies you have saved | save another |

The list goes on the **left** and the form on the **right**, sticky. Grid tracks
are positional, so on the four `business-data` tabs — where the form comes first
in the DOM so the mobile order is unchanged — the columns are reversed with
`lg:order-1` / `lg:order-2` rather than by moving the markup.

### The `min-w-0` bug, pre-emptively

`/super-admin/quality` had a 5px overflow from a grid child without `min-w-0`,
because a grid or flex child defaults to `min-width:auto` and a wide table
stretches its track until the page runs past the viewport. Seven more containers
in the company panel had the same defect and were only saved by accident —
`src/components/ui/table.tsx` wraps every `<Table>` in `overflow-auto`, and a
scroll container has an automatic minimum size of 0.

That accident stops holding the moment anyone widens these layouts, which is
exactly what this pass did. So `[&>*]:min-w-0`, and `minmax(0,…)` tracks where an
arbitrary value was already there, were added to:

`reports:202`, `help-desk:214/483/1016/1056`, `help-desk/loading.tsx:10`,
`quality:302`, `quick-actions:156`, `helpdesk-document-review.tsx:114`,
`helpdesk-internal-chat.tsx:333`, `helpdesk-chat-preview.tsx:49`,
`helpdesk-issue-report-form.tsx:77`, `quality-feedback-form.tsx:37/55` — plus
every new two-column grid above.

---

## 10. Labels and options

### Where a label lives

Two label systems already existed and pages used them interchangeably. The rule
now:

- **`src/lib/labels.ts`** (`companyLabel(domain, value)`) owns anything whose
  wording differs between the shop owner and the platform operator — roles,
  languages, conversation statuses, capabilities. It was already right; nothing
  was duplicated out of it.
- **`src/lib/constants.ts`** (`labelFor(map, value)`) owns flat display maps for
  everything else, always paired with `humanizeToken` so an unmapped value from
  Meta or Shopify degrades to readable English rather than to `undefined`.

Fourteen local `Record<string,string>` maps were deleted and replaced by shared
ones. New maps added to `constants.ts`: `PRESENCE_LABELS`,
`INVITE_STATUS_LABELS`, `ACTIVATION_STATUS_LABELS`, `BROADCAST_STATUS_LABELS`,
`APPOINTMENT_STATUS_LABELS`, `WHATSAPP_TEMPLATE_STATUS_LABELS`,
`PRIVACY_REQUEST_LABELS`, `PLAN_LABELS`, `SUBSCRIPTION_STATUS_LABELS`,
`QUICK_ACTION_TYPE_LABELS`, `QUICK_ACTION_AUDIENCE_LABELS`,
`QUICK_ACTION_SOURCE_LABELS`, `QUICK_ACTION_CONTEXT_LABELS`,
`QUICK_ACTION_MOMENT_LABELS`.

Roles were deliberately *not* added — `companyLabel('role', …)` already owned
them, and a second copy in `constants.ts` is exactly the drift that file exists
to stop. One new module, `src/lib/webhook-events.ts`, holds the five webhook
events that `webhook-form.tsx` (a client component) and `webhooks/page.tsx` (a
server component) both need: a server component importing a plain object from a
`'use client'` module fails at runtime with the React Client Manifest error, so
it could not live in the form.

### Contradictions found and closed

Three places where the *same stored value* showed two different words on two
screens:

- `send_message` was "Message" on the Chat buttons list and "Send message" on the
  form; `internal` was "Help desk" on one and "Help desk bot" on the other.
- Bulk messages hard-coded the lead statuses as *New / Contacted / Qualified /
  Converted / Closed*, contradicting `LEAD_STATUS_LABELS` ("New enquiry", "I have
  contacted them", "Worth pursuing", "Became a customer").
- Guided chats called a flow "Live" while chat invites called the same idea
  "Active". Both now read `ACTIVATION_STATUS_LABELS`.

A fourth was introduced and then caught during this pass: the first draft of
`QUICK_ACTION_TYPE_LABELS` was keyed against invented values rather than the real
`QuickActionType` union in `src/lib/quick-actions.ts`, so seven of the ten stored
types would have fallen through to `humanizeToken` — `request_human` rendering as
"Request human". `contexts` and `context_mode` were also conflated into one map;
they are now `QUICK_ACTION_MOMENT_LABELS` and `QUICK_ACTION_CONTEXT_LABELS`.

### The rewrites

**Enum values that were printed raw**

| Page / component | Was | Now |
| --- | --- | --- |
| Team | `company admin` (from `role.replace(/_/g,' ')`) | Owner / Team member |
| Team | `online` / `away` / `offline` as button text | Available / Away from my desk / Not working |
| Team | `accepted` / `revoked` / `pending` | Joined / Cancelled / Waiting for them to accept |
| Bookings | `requested`, `no show` | Asked for — not confirmed, They did not turn up |
| Orders, Customers | `ORDER_STATUS_LABELS[s] ?? s` (raw fallback) | `labelFor(...)` — degrades through `humanizeToken` |
| Customers | raw `lead.status`, `appointment.status`, `order.status` | the three shared maps |
| Bulk messages | `whatsapp` → "Whatsapp"; `sent` / `sending` | WhatsApp; Sent / Sending now |
| Chat invites | `active` / `paused` | Switched on / Paused |
| Guided chats | `web_chat` → "web chat" | Website chat |
| Reports | raw `a.role`, `a.trigger`, `a.channel` | Owner; humanised event name; Website chat |
| WhatsApp templates | `APPROVED`; `en_US`; raw category | Approved — you can send it; English; Marketing |
| WhatsApp contacts | raw `channel`, `source` | Website chat; Stop keyword |
| Agency | `past_due`; `free_trial` | Payment failed; Free trial |
| Improve answers | `EN`; "No Answer"; "Weak Retrieval" | English; "It did not answer at all"; "What it found did not really fit" |
| Improve answers (fix types) | Knowledge / Faq / Policy / Prompt | Missing answer / FAQ answer / Policy or rule / Assistant instruction |
| Insights | `avg_response_seconds`, "sla breach rate" | Answered too late — 17 real keys mapped, the rest humanised |
| My business info | raw knowledge-document status | `companyLabel('documentStatus')` |
| Settings | `delete` / `export` | Delete my data / Send me my data |
| Send data elsewhere | raw plan key | Free trial / Growth |
| Staff help desk review | `update_stock`; `required` | Update stock; Must be filled in |
| Chat buttons + its form | four duplicated local maps, different wording in each | one shared set of five maps |
| Automatic messages | `capitalize` on a raw hook name | the provider's real product name |
| Team / groups / API keys | `company_admin` in option text; `leads:read` as a checkbox's primary text | Owner / Team member; the human scope name, with the token demoted to a second line |

**Controls that had no label at all**

| Component | Control | Now |
| --- | --- | --- |
| `list-controls.tsx` (shared) | search box and status select — placeholder-as-label | `FormField` with visible labels the caller names |
| `quick-action-form.tsx` | **all twelve** `<Label>`s had no `htmlFor` and no control had an `id` — nothing on the form was programmatically labelled | twelve `FormField`s with per-instance ids, because the page renders this form once to create plus once per existing row |
| `quick-action-form.tsx` | repeating field row: `<Input placeholder="Field label">`, an unlabelled type `<Select>`, an icon-only delete | "Question 2" / "Kind of answer" / `aria-label="Remove question 2: Preferred date"` |
| `helpdesk-document-review.tsx` | six `<Label>`s with no `htmlFor` | six `FormField`s |
| `ticket-panel.tsx` | tags input (**with no `name` either**), resolution and note textareas, all under plain `<p>`s | three `FormField`s |
| `test-assistant.tsx`, `helpdesk-chat-preview.tsx`, WhatsApp contacts search, WhatsApp catalogue row | placeholder-only inputs | real labels — `sr-only` only where a visible one would break a composer mock |
| `webhook-form.tsx` | `<Label>` over a bare `<div>` of checkboxes | `<fieldset>` + `<legend>` |
| Team | three presence buttons with no group name | `<fieldset>` + `<legend>Set my status to</legend>` |

**Fields missing the one thing you needed to know**

| Field | Hint added |
| --- | --- |
| Inbox rules → "Answer within" (was "First-response SLA (minutes)") | the unit, when the clock starts, and a worked example — this is the field people get wrong by a factor of sixty |
| Spending cap → monthly limit | the currency, which appeared nowhere at all; what happens at the limit; what empty means |
| "Keep chat history for" (was "Retention period (days)") | that it deletes permanently, and that **shortening it deletes existing chats immediately** |
| Chat buttons → "Show only on these pages" | that leaving it empty shows the button on every page |
| Chat buttons → "Assistant" | what leaving it on "All assistants" actually does |
| Chat buttons → "Business hours" | which opening hours it reads, and what happens when none are set |
| Website chat → bottom / side spacing | that the unit is pixels |
| Shopify → API version, currency, extra key/secret | where to find each, and that most shops leave the last two empty |
| Staff help desk → "Confirm" / "Dry-run sandbox test" | what each does to the live shop system, and what happens if left unticked |
| Inbox rules → connector-failure delay | the unit, and why an action stuck in a queue is worse than one that failed outright |

**Buttons that did not say what they do**

| Was | Now |
| --- | --- |
| Delete (reply-time target) | Delete this target — "Chats covered by this target stop being timed, and you will no longer be warned before one goes late." |
| Delete (chat invite) | Delete this invite — names the invite |
| Delete (service / policy / FAQ / file / location) | Delete this service / policy / answer / file / location — each naming what the assistant will stop being able to answer |
| Remove (team member) | Remove from the team — "…is signed out immediately and can no longer open your inbox or see any customer details." |
| Remove (group member) — **fired on the first click, no confirmation at all** | `ConfirmSubmit` naming the person and saying they keep their account |
| Regenerate (mobile signing secret) — **no confirmation, and the warning only appeared afterwards** | "Replace secret — breaks apps already shipped", confirmed, with the warning moved before the click |
| Forget (push device) | Stop alerts on this device |
| Ignore (help-desk screen) | Do not use this screen — "…removes this screen from the list for good" |
| Cancel (bulk message) | Cancel this send |
| Update (order / booking status) | Save status, with a per-row `aria-label` naming the customer |
| Add (starter automation) — four identical buttons on one screen | Use this one |
| Add (group member / contact) | Add teammate to group / Add contact to group |
| Save (retention) | Save and start deleting older chats |
| Save (auto top-up) | Save automatic top-up settings |
| Save (inbox rules) | Save these inbox rules |
| Save (conversation tags) | Save tags |
| Pause / Activate (target, invite, flow) | Stop using this target / Start showing this / Take this off my website |
| Duplicate (flow) | Make a copy |
| Ask | Ask the assistant |
| Open (a late chat) | Read the chat |

**Copy written for the wrong reader**

| Page | Was | Now |
| --- | --- | --- |
| New assistant | "Prompt templates & advanced tuning come in **Module 6**." — an internal roadmap note, shown to shop owners | "Say who it talks to and tick the jobs you want it doing. You can change any of this later, and nothing goes live until you put it on your website." |
| Spending cap | "AI Cost Controls — Budget guardrails, provider fallback, and answer caching." | "Spending cap — What your assistant costs you to run, and the ceiling you want it to stop at." |
| Inbox rules | "Support settings — Response-time targets, agent routing, and business hours." | "Inbox rules — How quickly you promise to reply, who a handed-over chat goes to, and the hours that promise applies in." |
| My business info | "Assistant business memory — These facts are **injected into** assistant answers and handoff decisions." | "What your assistant should know — Facts the assistant repeats back to customers, and the rules that tell it when to stop and fetch a person instead." |
| My business info | "Company record — This is your **account-level** company name, website, language, country, and timezone." | "Your company — …the assistant uses the language and time zone to decide how to answer and what counts as today." |
| Team | "Agent workspace link" | "Sign-in link for your staff" |
| Team | the members table had **no heading at all** | "Everyone who can sign in"; columns renamed "What they can do" and "At their desk" |
| Reply-time targets | "Recent breaches" / "No breaches" | "Chats that went past their target" / "Nothing was late" |
| Inbox rules | "Enable business hours (pauses SLA tracking when closed)" | "Only count the time while you are open" |
| Inbox rules | "Agent routing → Round-robin (balance load)" | "Who gets a chat when the assistant hands one over → Share them out — whoever has the fewest open chats" |
| Chat-button analytics | "Clicks / Completed / Conversion" | "Taps / Finished what they started / Share that finished" |
| Guided chats | "No flows yet … Start from a template below." | "You have no guided chats yet … Start from one of the templates beside this." |

Two live-region fixes rode along: `support-settings-form.tsx` and
`quick-action-form.tsx` both hand-rolled a green "Saved." `<p>` that was not a
live region, so a screen-reader user pressed Save and was told nothing at all.
Both now use `FormMessage`.

---

## 11. Still broken, owned elsewhere

- **`business_hours_mode` on chat buttons is written but never read.**
  `quick-actions-actions.ts` saves it and `quick-actions-data.ts` maps it, but
  nothing in `src/lib/quick-actions.ts` or the widget ever checks it — so "Only
  while you are open" currently changes nothing. The hint was worded to describe
  what the setting is *based on* rather than to promise behaviour that does not
  happen, with a comment saying so, but the control is inert.
- **Two CSAT tables.** The widget writes `conversations.csat_rating`; the 30-day
  report reads `conversation_ratings`. Home now uses the first, so Home and
  Reports can disagree about the same week until one of them wins.
- **`extra_key` / `extra_secret`** are written into the encrypted credentials blob
  and nothing in the codebase reads them. If they are dead, deleting the two
  fields beats explaining them.
- **`ConfirmSubmit` has no `aria-label` prop**, so naming the target of a
  destructive action has to happen in the visible label. That makes the two group
  Remove buttons wide on long email addresses.
- **No timezone or country label maps.** `TIMEZONE_OPTIONS` lives in
  `src/modules/company/form-options.ts`; four selects render raw IANA ids, and an
  identical `timezoneLabel()` helper now exists in two components with a comment
  in each saying the duplication is deliberate. It belongs beside
  `TIMEZONE_OPTIONS`.
- **`flow-inspector.tsx` was not touched.** Its local `Field` renders a `<Label>`
  with no `htmlFor` and never sets an `id`, so roughly 25 controls in the
  guided-chat builder are visually labelled but not programmatically associated;
  its "Wait for" number field states no unit; and its Method select lists bare
  HTTP verbs. `FormField`'s own docstring already names that `Field` as one of the
  two duplicates it was written to replace. Left alone because the flow builder
  is another workstream's.
- **Answer-quality verdicts and quality fix types** are defined locally in
  `quality/page.tsx`. The super-admin quality screens render the same stored
  values, so both maps should move to `constants.ts` before they drift.
- **There is still no shared page-shell primitive.** `mx-auto max-w-… space-y-6`
  is now hand-copied into 45 files instead of 41. A `<PageShell width>` beside
  `PageHeader` would make the next width decision one edit rather than
  forty-five — `PageHeader`'s own comment records that the identical duplication
  problem was already solved this way once.

---

# Part three — the field-by-field audit

Parts one and two renamed things. This pass asked a different question of every
field on every company screen: **does this control do what it says, and does it
apply at all right now?**

Six defect classes, in the order they cost an owner money:

1. A picker chooses a mode and every mode's fields render anyway.
2. The same underlying value is settable in two places.
3. A setting is saved and nothing ever reads it.
4. A field accepts the wrong thing, or its placeholder shows a wrong example.
5. A label does not say what happens.
6. A control is not programmatically labelled.

The archetype for class 1 was already fixed before this pass —
`notification-settings-form.tsx` rendered Meta's credential block and Twilio's
at the same time, so a company on Twilio was asked for Meta's phone-number-id
and one account put an email address in it. This pass swept for the rest.

## 12. The pattern for hiding a field that does not apply

Almost every action in this codebase **rebuilds its whole settings object from
the submitted form**. `updateWidgetDesignAction` is the clearest case: a field
absent from the FormData becomes `undefined`, `textOrNull(undefined)` returns
`null`, and the stored value is gone. A checkbox that is not rendered is
indistinguishable from one that was unticked.

So *removing* an inapplicable field from the DOM silently deletes data the
owner had saved. Everything below hides the visible control and leaves a hidden
input carrying the current value:

```tsx
{avatarMode === 'image' ? (
  <FormField label="Avatar image address" htmlFor="agentAvatarUrl" hint="...">
    <Input name="agentAvatarUrl" type="url" value={agentAvatarUrl} />
  </FormField>
) : (
  <input type="hidden" name="agentAvatarUrl" value={agentAvatarUrl} />
)}
```

Switch away and back and the address is still there. For a checkbox the hidden
value is `checked ? 'on' : ''`, because every one of these schemas parses with
`z.preprocess((x) => x === 'on', z.boolean())`.

## 13. Findings

| Screen | Field | What was wrong | What was done |
| --- | --- | --- | --- |
| **Website chat** | Avatar image address | Rendered whatever the avatar style was, with a hint admitting *"only used when avatar style is image"*. `widget.js:442` reads it on that one value. | Shown only when the style is Image. Gained `type="url"` and a real example. |
| Website chat | Launcher image address | Same shape — hint said *"only used when launcher icon is custom image"* (`widget.js:896`). | Shown only when the icon is Custom image. `type="url"`. |
| Website chat | Alert dot colour | Offered while the dot was set to Hidden, where `widget.js:903` skips the dot entirely. | Hidden when the dot mode is Never. |
| Website chat | **Alert dot mode** | Three options, **two behaviours**. The only branch anywhere is `=== 'hidden'`, and the widget has no unread tracking at all, so "Show" and "Always show" painted an identical dot. | Collapsed to *Show it* / *Never show it*. The stored value is untouched — a company on `always` keeps `always` and reads as "Show it", which is what it does. |
| Website chat | Desktop / mobile auto-open delay | Both asked for a number regardless of whether that device's auto-open was on; `widget.js:1246` only reads the delay for a device whose switch is on. | Each delay follows its own switch. |
| Website chat | Auto-open once per visitor | Qualified two switches that could both be off. | Shown only when at least one auto-open is on. |
| Website chat | Glow on mobile only | Sub-option of a switch that could be off. | Shown only when the glow is on. |
| Website chat | CSAT comment / prompt / thank-you | All three rendered with ratings switched off, so an owner wrote wording no visitor would ever see (`widget.js:1370`). | Shown only when ratings are on. |
| Website chat | **Offline label** | **Dead.** Stored, serialised, assigned to `state.offlineLabel` at `widget.js:546` — and never rendered. `onlineLabel` is the only status text the header ever gets (`:343`, `:586`). | Relabelled *"Out-of-hours status line — not shown yet"*, hint says plainly that nothing typed there reaches a visitor. Left editable: the column is real and one line of widget work would use it. |
| Website chat | Launcher label | Invisible on a circle launcher (CSS at `widget.js:174`), but still used to derive the initials when the icon is Initials — so not simply inapplicable. | Kept, with a hint that changes per launcher style and says which of the three situations you are in. |
| Website chat | Theme presets | `<Label>` with no `htmlFor` over six buttons — a `<label>` bound to nothing. | `fieldset` + `legend`. |
| Website chat | Status labels, footer | Labelled by their variable names — "Online label", "Typing label", "Footer text". | Named by where they appear: *Status line under the title*, *What it says while a reply is being written*, *Small print at the bottom of the chat*. |
| **Chat invites** | Open the chat automatically | **Dead.** `scheduleProactiveCampaign` (`widget.js:1260-1280`) reads `message`, `matchUrl` and `delaySeconds` off the rule and then calls `openWidget(true)` **unconditionally**. Unticking it produced an invite that opened the chat anyway. | Control removed — opening the chat *is* what a chat invite is. Hidden input keeps `auto_open` true; one sentence explains the difference from Chat buttons. |
| Chat invites | Every other field | "Campaign name", "Show on pages containing (optional)", "Delay (seconds)" — no hints, and `matchUrl` reads as a URL but is a substring match. | Renamed and hinted; the match field says explicitly it is a fragment, not a link. |
| **Staff help desk / chat rules** | Auto-open when allowed | **Dead.** `canShowHelpdeskChat` (`chat-settings.ts:62-72`) reads `enabled`, `showMode === 'hidden'`, `blockedRoutes`, `allowedRoutes`. Nothing anywhere reads `auto_open`. | Removed; value carried in a hidden input. |
| Staff help desk / chat rules | Position (Right / Left) | **Dead.** Same evidence. Not the widget's `position`, which is a different column and *is* used. | Removed; value carried. |
| Staff help desk / chat rules | Show mode | Only `hidden` is ever branched on, so "Floating bubble" and "Embedded panel" were behaviourally identical, and picking Hidden duplicated the Enabled checkbox beside it. | Folded into the on/off switch, which now says what switching off does. |
| **Automatic messages** | Subject / template name | Read **only** as the email subject (`automations.ts:289`). On WhatsApp nothing reads it, and the label implied it might be an approved WhatsApp template — a different thing entirely. | Email only, renamed *Email subject line*. Hidden input on WhatsApp. |
| Automatic messages | Only above this order total | Offered on *New customer*, whose entity carries no money. `evaluateConditions` (`automation-templates.ts:212`) compares the minimum against 0, so setting one **stops the rule firing at all**. | Not offered on that event. |
| Automatic messages | "Active — send this automation" | Ambiguous — active as in enabled, or as in busy? | *Send this message to customers from now on.* |
| **Connect your shop** | Provider | `FormField` wrapping a `Select` **and** a `<p>`. `FormField` clones a *single* child to inject the `id`, so with two children it injects nothing and `<Label htmlFor="provider">` pointed at no element. | Description moved into `hint` — wired up and read out on focus. |
| Connect your shop | Every credential | The action validates **only** `provider` and `name` (`integrations-actions.ts:44-47`). A shop could "connect" WooCommerce with no URL and no keys, be told *"Integration connected"*, and then fail on every refresh with *"Missing WooCommerce credentials"*. | The fields `sync.ts` actually refuses to run without are now `required`, so the failure surfaces at the field that caused it. Each gained a hint naming the exact menu it comes from. Shopify's domain gets a `myshopify.com` pattern; the currency boxes get `[A-Za-z]{3}`. |
| Connect your shop | Custom API paths | Placeholders showed the value that is used anyway when empty, so they read as examples to replace. | Hints say what empty means; `pattern="/.*"`. |
| **Messaging apps** | WhatsApp provider | No explanation of the choice. | Hint changes with the choice and says what each provider means in practice. |
| Messaging apps | WhatsApp connection | See section 14 — the same credentials are asked for again on Alerts, into a different table. | A note names the split: this number answers customers, Alerts messages *you*. |
| **My assistants** | Assistant name | `"Assistant name *"` — the asterisk was decoration; `FormField` has a `required` prop that does it properly. | `required`, plus a hint. |
| My assistants | Type | Second `FormField` with two children — the `Select` got no `id`. | Explanation into `hint`. |
| My assistants | Website addresses | Same two-child defect on a `Textarea`. | Explanation into `hint`, which now also says to leave `https://` off. |
| My assistants | Type (staff assistant) | Bare `<Label>` over a read-only div — a `<label>` bound to nothing. | Plain styled `<p>`; it was never a control. |
| My assistants | Questions from your shop system | Rendered greyed-out for a customer assistant with nothing saying why. | Shown only for a staff assistant. Stored value is unchanged — the hidden `off` is what was already saved in that case. |
| My assistants | **Default language** | See section 14 — the same label as the company profile's, different column, different meaning. | *Language it answers in*. |
| **Your company** | **Default language** | Same collision. And "Auto-detect" was untrue: `normalizeLocale` (`i18n/index.ts:38`) maps anything but `ar` to `en`, so picking it gives you English. | *Dashboard language*; the option now reads *English (the default)*. Same fix in the agency sub-account form, which had a third phrasing and one option written in Arabic while the other two were in English. |
| Your company / Connect your shop | Timezone | An identical `timezoneLabel()` helper in two components, each with a comment saying the duplication was deliberate for want of somewhere shared. | Moved to `src/lib/constants.ts`. Both import it. |
| **My business info** | Location time zone | Rendered raw IANA ids — `Asia/Dubai` — in a list of several hundred. | `timezoneLabel`. The hint also names this as the zone the reply-time clocks are actually counted in (see section 14). |
| My business info | Postal code, Google Maps link | **Dead.** `business-context.ts:131-136` builds the location line from name, address, city, region, country, phone and service area only; `google_maps_url` is selected and dropped, `postal_code` is not selected at all. | Labelled *"kept on file only"*, hint says the assistant will not repeat it. Left editable — the columns are real. |
| My business info | Phone, WhatsApp, branch phone | No `type`, so a phone got a full keyboard and no format guidance, for numbers the assistant reads aloud to customers. | `type="tel"`, `inputMode="tel"`, country-code hints and examples. |
| **Improve answers** | Expected source | **Dead.** Selected by the runner (`eval.ts:72`) and never used — the pass/fail at `eval.ts:110-125` turns purely on whether *anything* was retrieved. | Relabelled *"Where the answer should come from — your note"*, hint says the test does not check it. |
| **Assistant settings** | Custom base prompt | Label admitted in a parenthesis that it was *"used only when type = Custom"* — so every other assistant got a large textarea that changed nothing, in a syntax nobody outside the team writes. | Shown only for a Custom assistant; otherwise one sentence saying so, and a hidden input so a prompt someone wrote is not erased. |
| Assistant settings | Industry, Tone | See section 14 — both also set on My business info, both reaching the same reply. | A panel above them says which screen wins and why; each hint names its counterpart. |
| Assistant settings | Save button | "Save & rebuild prompt" — internal vocabulary. | *Save these instructions.* |
| **Inbox rules** | Answer within | See section 14. | *Mark a chat late in the inbox after*, with a link to the screen that owns warnings and escalation. |
| Inbox rules | Only count the time while you are open | **Dead.** Written to `company_settings.business_hours.enabled`, read straight back out to fill in the same box, and read nowhere else — the local `isWithinBusinessHours` (`support-settings-data.ts:179`) has no call sites anywhere in the repo. | Control removed, value carried in a hidden input, and the section now points at the per-target checkbox on Reply-time targets that genuinely does this (`sla_policies.business_hours_only`, read at `sla/index.ts:182`). |
| **Chat buttons** | Business hours | The hint was written when this was inert and deliberately avoided promising behaviour. It has since been wired up (`quick-actions.ts:205`) and the hedge had gone stale. | *When to show it*, hint now states plainly what the choice does. |
| Chat buttons | Phone number | No `type`. | `type="tel"`, `inputMode="tel"`. |
| **Alerts** | Missed conversation | **Dead.** In the `NotifyEvent` union and in `CORE_EVENTS`, but **nothing in the codebase ever emits it** — every other event on that grid has a dispatch site. Its five toggles configure a delivery that cannot happen. | Labelled *"A chat nobody answered — not sent yet"*. The whole event list was also rewritten from our event names into what happened ("Human handoff request" to *A customer asked for a person*). `notification-settings-form.tsx` itself was not touched. |
| **Who you may message** | Contact | One box holding a phone number on two channels and an email address on the third, always placeheld `+971500000000`, with the server error *"A phone number is required"*. | Channel moved first; the box below re-labels, re-types (`tel`/`email`) and re-placeholders itself from it. |
| Who you may message | "Opted in" | Jargon for a consent record. | *They agreed to be messaged.* |
| **Get set up** | Website URL | `type="text"` on a field whose placeholder is an address — no keyboard, no autofill, no format check. | `type="url"`, `inputMode="url"`, plus a hint. |
| **Agency** | Logo URL, Login background | No `type="url"`, no hint on the background at all. | `type="url"`, examples, and a hint saying what empty means. |
| **Trigger phrases** | Example phrases | `<Label>` with no `htmlFor` over a chip group. | `fieldset` + `legend`. |
| Trigger phrases | The chip input | Placeholder-only — announced as an unnamed text box, and the placeholder vanishes on the first keystroke. | `aria-label`. |
| Trigger phrases | "Test a phrase" input | Placeholder-only, same defect. | `aria-label`. |
| **Staff help desk chat** | Route box | Neither a label nor a placeholder — an icon beside it, which is not a label. | `aria-label` plus a placeholder. |
| Staff help desk chat | Composer | Placeholder-as-label. A visible label would break the composer mock. | `aria-label` — the one place it is the right answer rather than the lazy one. |
| Staff help desk chat | Connector action fields | Field name lived only in the placeholder, and the required marker was a bare `*` with no `required` behind it. | `aria-label` naming the field and whether it is required, plus a real `required`. |
| **Enquiries** | Phone | No `type`. | `type="tel"` and an example. |
| **Agency sub-accounts** | Website | No `type="url"`. | `type="url"`, real example instead of a bare `https://`. |

Three of these deserve naming separately, because they were invisible rather
than merely unclear: `FormField` injects the control's `id` by cloning **a
single element child**. Give it two — a `Select` and a stray `<p>` — and
`React.isValidElement` is false, no `id` is injected, and the `<Label htmlFor>`
above points at nothing. That had happened in three places
(`connect-integration-form.tsx`, and twice in `bot-form.tsx`) and is undetectable
by eye, since the label still *looks* attached. All three explanations moved into
the `hint` prop, which is where they belonged anyway.

## 14. The same thing, set in two places

Every row below was verified against the reader, not just the writer.

| What | Place A | Place B | Which one wins | What was done |
| --- | --- | --- | --- | --- |
| **"Answer within N minutes"** | Inbox rules, `company_settings.sla_response_minutes` | Reply-time targets, `sla_policies.first_response_minutes` | **Split.** A colours the late chip in the inbox and nothing else (`inbox/page.tsx:240`). B drives the clock, the early warning and the escalation (`sla/index.ts:60-83`). Set 5 on one and 15 on the other and the inbox flags chats late that nothing is warning you about. | Both screens relabelled to name the narrow thing they do, and each points at the other. |
| **Business hours on/off** | Inbox rules checkbox (`company_settings.business_hours.enabled`) | Reply-time targets, per target (`sla_policies.business_hours_only`) | **B only.** A is read by nothing. | A removed; the section points at B. |
| **Industry** | Assistant settings, `bot_settings.prompt_config.industry` | My business info, `company_business_profiles.industry` | **Both, at once.** A is baked into the stored system prompt (`assemble.ts:45`); B is injected fresh every turn (`business-context.ts:106`). Put "clinic" in one and "retail" in the other and the model gets both. | Cannot be collapsed without touching prompt assembly. A panel on the assistant screen names the other field and says B is the one the model is instructed to follow. |
| **Tone / brand voice** | Assistant settings, `prompt_config.tone` | My business info, `brand_voice`, `answer_length`, `sales_style`, `tone_notes` | **B nominally.** A colours the persona line (`assemble.ts:41`); B is listed in the business facts under an explicit *"Follow company tone fields"* instruction (`engine.ts:406`). | Same panel; each hint says which wins. |
| **"Default language"** | Your company, `companies.default_language` | Assistant settings, `bots.language_default` | Genuinely different: A is the dashboard locale (`i18n/server.ts:41`), B is the assistant's reply language. Not a data duplicate — a **label collision**, identical wording and identical options on two screens. | Renamed to *Dashboard language* and *Language it answers in*. |
| **WhatsApp credentials** | Alerts, `company_notification_settings` (`whatsapp_provider`, `meta_phone_number_id`, tokens) | Messaging apps, `channel_identities` (`external_id`, `secret_encrypted`, `settings_json.provider`) | **Neither — they serve different jobs and nothing syncs them.** Inbound reconciles (a `channel_identities` row wins, `webhooks/whatsapp/route.ts:63-73`); outbound does not. Staff alerts read `company_notification_settings` *only* (`notification-delivery.ts:174`). So a shop that connects WhatsApp on Messaging apps gets **no WhatsApp staff alerts** until it re-pastes the same number and token on Alerts. | A note on the channel form names the split and links across. The Alerts side could not be touched. |
| **Slack / generic webhook** | Alerts (legacy fields) | Send data elsewhere, `webhook_endpoints` | **B.** `notify.ts:52-72` dispatches to the endpoints first and suppresses the legacy channel (`notification-delivery.ts:512`). | Nothing — the existing deprecation banner was **checked and is accurate**, including its claim that email and WhatsApp are unaffected. |
| **Widget header title** | Assistant settings (writes `appearance_json.title` only while it still equals the old bot name) | Website chat design studio (writes it unconditionally) | Same table, same JSON key, reconciled by a `followsName` heuristic (`actions.ts:277-281`). | Nothing — verified working. A custom title survives a rename; a default one follows it. |
| **Time zone** | Your company, `companies.timezone` | My business info, location, `company_locations.timezone` | **B**, for the primary location — it is what `sla/index.ts:107` and `business-hours.ts:40` read. The Inbox rules screen prints **A**. | Reported below; the location field's hint now says it is the one that counts. The screen that prints the wrong one is in `support-settings-data.ts`, which this pass may not edit. |

## 15. Found, not fixed

- **The timezone contradiction is only half closed.** Inbox rules displays
  `companies.timezone` while the SLA engine and "are we open now" use
  `company_locations.timezone` for the primary location. Changing the zone on
  the company profile does not move the reply-time clock. The fix is in
  `support-settings-data.ts:114/148`, which is another agent's file this week.
  There is also no update action for a location's timezone at all — it is seeded
  from the company at insert and never changed.
- **WhatsApp credentials still have to be typed twice.** The note on the channel
  form tells the owner why, but the real fix is for staff alerts to fall back to
  `channel_identities` when `company_notification_settings` is empty. That is in
  `notification-delivery.ts`.
- **Industry and tone still reach the model from two places at once.** Only
  prompt assembly can decide a precedence; the screens can only warn.
- **`scheduled_timezone` on bulk messages is dead.** The composer sends the
  browser's zone in a hidden input and `broadcasts-actions.ts:99` stores it, but
  the cron sender's select omits it (`cron/broadcasts/route.ts:48`), so a
  scheduled time is interpreted with no zone at all. No visible control, so
  nothing to relabel — but "9am" does not currently mean 9am anywhere in
  particular.
- **`conversation_statuses` on chat buttons is dead.** Round-tripped through a
  hidden field and stored; the runtime filter applies page patterns, required
  capabilities, keywords and business hours, but never this. No visible control.
- **Config with no UI at all**, the reverse problem: `nlu_settings.settings_json`
  (`endpoint` and `minConfidence` are branched on in `flows/nlu.ts` but nothing
  writes them, so INTNT is stuck on its defaults), `eval_questions.
  expected_answer_type`, and `sla_policies.applies_group_id` — matched at
  `sla/index.ts:51` with no field to set it.
- **The flow builder was left alone**, as in part two. `flow-inspector.tsx` still
  has ~25 controls whose local `Field` renders a `<Label>` with no `htmlFor` and
  never sets an `id`; `flow-triggers-panel.tsx` and `flow-builder.tsx` each have
  a bare `<Label>` too. Another workstream owns these.
- **The company's spending cap is also writable by super-admin**
  (`super-admin/actions.ts:147`) with nothing on the company screen saying a
  platform admin can overwrite it. Not a duplicate within the company dashboard,
  so out of this pass's scope, but worth a line on that screen.
- **`extra_key` / `extra_secret`** on Connect your shop remain dead, as recorded
  in section 11. They are now the only fields in that form with no `required`
  and no format hint, which is the correct signal for a passthrough.

## 16. Section 11 is now partly out of date

`business_hours_mode` on chat buttons is **no longer inert** — it is read at
`src/lib/quick-actions.ts:205`, whose own comment records that it used to be a
saved setting nothing read. The hedged hint that section 11 describes has been
replaced with one that states what the choice does. The rest of section 11
stands.

---

# Part four — the primitives (Module 24)

Parts one to three moved pages around. This part is about the 29 things in
`src/components/ui/` that every page is built out of, on the theory that a defect
in a primitive is 70 defects on screens, and a primitive that is easy to misuse
produces the same bug over and over in files nobody thinks are related.

Nothing here is a new design system. The tokens, the type scale, the elevation
rules and the radius scale from Module 22 are unchanged; this fixes things that
were wrong inside them, and closes the gaps that were forcing pages to hand-roll.

## 17. The one rule that keeps being broken

**`sm:` `md:` `lg:` `xl:` measure the VIEWPORT. They tell you the width of the
window. They tell you nothing about the box your component is in.**

The proof is in the repo. A form was laid out `lg:grid-cols-4` inside a column
about 500px wide. On a full-width screen `lg:` fired, each field got about 110px,
and a `<select>` clipped its own text mid-word. Every viewport breakpoint said
"plenty of room". There was none.

This is not a rare mistake. About a third of the dashboard is two-column —
`lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]` appears in a dozen pages — so
about a third of the product has a narrow column that every `lg:` inside it will
lie about.

### What to use instead

| Situation | Use |
| --- | --- |
| A grid of form fields, anywhere | `FieldGrid` |
| A term/value list | `DescriptionList` — its `rows` variant wraps on the container |
| Two halves that should stack when cramped | `flex flex-wrap` with a `basis-*` on each half |
| A page-level shell: sidebar or no sidebar | `md:` — genuinely a viewport question |

`FieldGrid` is `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`. The
`min(100%, …)` clause is the part people leave out and the part that matters: it
stops a 16rem floor from producing a 256px column inside a 200px parent and
giving the page a horizontal scrollbar.

`flex-wrap` + `basis` is the same idea without a grid. Flexbox wraps when the
items no longer fit **their parent**, which is the actual question.

### When a viewport breakpoint IS right

When the thing you are asking about really is the window: whether the sidebar is
on screen (`md:`), whether a drawer or a permanent nav is in play, whether the
page has room for a second column at all. `PageHeader` uses `sm:` to decide
whether its actions get their own line — correct, because it spans the page.

There is now an `xs:` breakpoint at 400px, for the real gap between one phone
column and 640px. It is defined in `theme.screens` rather than `theme.extend`
because extending appends instead of sorting, which would emit the `xs:` media
query after `2xl:` and let `xs:` quietly beat `sm:` at every width above 400px.

## 18. The size scale

Two heights. Every control has both, and they come from one file —
`src/components/ui/control-styles.ts` — so they cannot drift.

| Size | Height | `Button` | `Input` | `Select` | Use |
| --- | ---: | :---: | :---: | :---: | --- |
| `default` | 40px | yes | yes | yes | Forms |
| `sm` | 36px | yes | yes | yes | Toolbars, filter bars |
| `lg` | 44px | yes | — | — | Page-level call to action |

Square icon buttons follow the same rhythm: `icon` 40px, `icon-sm` 36px,
`icon-xs` 32px. All three clear the 24px WCAG 2.5.8 target minimum. **An
icon-only button has no accessible name — always pass `aria-label`.**

Before this, `Input` had exactly one height and no variant, so a 36px filter bar
could not use it. `list-controls.tsx` carries a hand-written `inputCls` whose own
comment reads "the one control that could not adopt its primitive", and
`reports/page.tsx` hand-rolls two more at `h-9`. Those three can be deleted now
in favour of `<Input size="sm">`; they live in files this pass does not own, so
they are listed in section 22.

`Textarea` deliberately has no size variant: the scale exists to line a control
up with the button beside it in a row, and a multi-line box is never in that row.

## 19. Composition traps, and what was done about each

A primitive that bakes in a box — a height, a radius, a border, a padding — is
fine on its own and dangerous the moment you put it inside another box. Every one
of these is a bug that shipped.

**`Input` inside a bordered wrapper gives two radii.** The password field was an
input and a button inside a bordered `rounded-xl` flex row. `Input` carries its
own `rounded-md`, so the control had one corner radius inside another. It looked
fine empty and broke the instant a browser autofilled it, because autofill paints
the `<input>` and not the wrapper. *Fixed by `PasswordInput`, which is the pattern
to copy: a `relative` wrapper with no box of its own, the trailing control
`absolute inset-y-px end-px` inside the input's own border, and room reserved with
`pe-*` rather than by shrinking the input.*

**`rounded-e-[inherit]` inherits from the wrong element.** `border-radius:
inherit` takes the PARENT's computed radius, and `PasswordInput`'s parent is that
bare `relative` wrapper, which deliberately has none — so it resolved to `0` and
the reveal button's focus ring drew a square corner over the input's rounded one.
*Fixed: `rounded-e-md`, stated rather than inherited.*

**`CardContent` bakes `pt-0`,** which is right under a `CardHeader` and wrong
without one. 88 call sites use `<Card><CardContent>` and 85 pass their own
padding — the workaround wearing a hat. *Documented rather than changed, because
changing the default silently re-spaces 88 screens mid-flight. A new card with no
header wants `<CardContent className="pt-6">`.*

**`Card` inside `Card` gives two borders and two radii,** and on a `bg-card` page
the inner surface is invisible, so all that shows is the doubled edge.
*Documented in the file. For a panel inside a card use `rounded-md border
bg-muted/30`, the same treatment `TAB_HELPER` uses.*

**`leading-none` collides the moment text wraps.** It was on `Label`,
`CardTitle`, `DialogTitle` and `AlertDialogTitle` — all four of which wrap
constantly, in a 360px sidebar, a three-up grid, or any screen at 375px. A line
box exactly the height of the font puts one line's descenders into the next
line's ascenders. *Fixed: `leading-tight` on all four.*

**`Table`'s wrapper is what stops the page scrolling sideways.** A `<table>` will
not shrink below its widest word, so a six-column table with a webhook URL in it
is wider than a phone. Never remove the wrapper, and never put a table in a grid
track without `min-w-0` — the track widens to the table instead, and then the
page scrolls.

## 20. What was actually broken

Ordered by how badly it failed, not by how big the diff is.

1. **`aria-invalid` was invisible.** `FormField` sets it on every control it
   wraps that has an `error`. But `aria-invalid` is **not** one of Tailwind's
   nine built-in `aria-*` variants (busy, checked, disabled, expanded, hidden,
   pressed, readonly, required, selected), so `aria-invalid:border-danger`
   compiled to nothing at all. Every failed field in the product announced its
   error to a screen reader and showed a sighted user a line of small red text
   under a field that still looked perfectly normal. *Registered the variant in
   `tailwind.config.ts`; `Input`, `Select` and `Textarea` carry a red border and
   a red focus ring off it now, with no opt-in at the call site.*

2. **Browser autofill had no dark mode.** Chrome, Edge and Safari paint an
   autofilled field with their own pale yellow, from a UA style on a pseudo-class
   that beats every class on the element. In dark mode that is a near-white field
   in the middle of a dark form — and because the UA overrides the background but
   not the text colour, the value can come out white-on-white. This is the same
   class of bug as the password field: correct while empty, wrong the moment a
   real browser touches it. *Fixed globally in `globals.css` with the
   inset-box-shadow technique plus `-webkit-text-fill-color`, both from tokens,
   so it resolves per theme.*

3. **A linked `StatTile` had no focus indicator at all.** The ring lives on
   `Card`'s children, not on the `<Link>` wrapping it, so tabbing through a stat
   grid looked like the page doing nothing. *Fixed.*

4. **The `Sheet`'s close button scrolled away.** The panel was the scroll
   container and the close control was `absolute` inside it — and an absolutely
   positioned child of a scroll container is placed in that container's
   *unscrolled* coordinates, so it travels with the content. Open the mobile menu
   on a phone, scroll to the bottom, and the visible way out is above the top of
   the drawer. Escape and the scrim still worked, which is exactly why it
   survived. *Fixed: the panel is `overflow-hidden` and an inner wrapper scrolls,
   so the close control stays pinned to the panel.*

5. **The password reveal was unreachable from the keyboard.** `tabIndex={-1}` is
   the usual shortcut for keeping Tab going straight from the password to the
   submit button, but revealing a password is functionality, and functionality a
   mouse can reach and a keyboard cannot is a WCAG 2.1.1 failure — on the one
   control a user who has just mistyped their password most needs. *Removed;
   `aria-pressed` already reported its state.*

6. **`PageHeader`'s actions overflowed at 375px.** `Button` is
   `whitespace-nowrap`, so a row of them has a max-content width it cannot go
   below; the container was `shrink-0`, so it kept that width, wrapped onto its
   own line, and then ran off the edge of that line — a wrapped flex item is
   sized by its content, not by the line it landed on. *Fixed: it may shrink, and
   below `sm` it takes a full-width line deliberately.*

7. **The desktop sidebar scrolled off the top of the page.** It was a plain flex
   item inside `flex min-h-screen`, so it stretched to the height of the whole
   page. On the inbox, or reports, or a long settings form, scrolling to a control
   left the entire menu above the viewport. The company menu is eleven items in
   four groups, so on a 700px laptop the last group was below the fold before
   anyone scrolled at all. *Fixed: `md:sticky md:top-0 md:h-screen
   md:overflow-y-auto`. The explicit height is load-bearing — a stretched flex
   item has no free space to travel in, so `sticky` on its own does nothing.*

8. **`InfoHint`'s panel ran off the screen.** 256px hung from the leading edge of
   a trigger near the trailing edge of the page put its text past the viewport,
   with no collision handling at all. *Fixed: it measures once on open and flips
   to the other edge, correctly in both writing directions.*

9. **A failed clipboard copy looked exactly like a success.** `CopyButton`
   catches the rejection and does nothing with it. `navigator.clipboard` is
   `undefined` outside a secure context — which throws *synchronously* rather
   than rejecting, so the existing catch would not even have run — and rejects
   outright when the document is not focused or permission is denied. The user
   pressed Copy, saw "Copy", and pasted whatever they had copied an hour ago.
   *`CopyField` says so, selects the text so Ctrl+C still works, and announces
   both outcomes in a live region.*

10. **`Textarea` could be resized into a horizontal scrollbar.** The default is
    resizable on both axes, and the user's drag lands as an inline pixel `width`
    that beats every class on the element, permanently. Widen one inside a card
    and the card overflows its grid column and the page scrolls sideways for
    good. *Fixed: `resize-y`. Vertical is the part people actually want.*

11. **The tab underline stopped after the last tab.** `min-w-max` sizes the rail
    to its content, so on a two-tab screen the rule looked cut off rather than
    like a rail the tabs sit on — and it was a different length on every screen.
    *Fixed: `w-max min-w-full`. Both are needed: `w-max` alone collapses to
    content, `min-w-full` alone lets a long rail wrap onto two lines.*

12. **`animate-pulse` ignored `prefers-reduced-motion`.** It is an infinite
    animation, so the existing reduced-motion block — which only shortens
    animations that end — never touched it. A user who asked for less motion sat
    in front of a page of boxes breathing at them for the whole load. *Fixed in
    `globals.css`, along with the colour and width transitions.*

13. **`Progress` used `transition-all`,** which also animates
    `background-color`: a bar crossing a threshold faded between two colours over
    150ms, and every bar on the page rippled on a theme switch. A sub-1% fill
    also rounded to a sub-pixel width, so "two of five hundred done" and "none
    done" rendered identically. *Fixed: `transition-[width]`, and a 2px floor on
    any non-zero value.*

14. **`InfoHint`'s panel was transparent.** It painted itself with `bg-popover
    text-popover-foreground` — two class names from the stock shadcn token set
    that this product deliberately never adopted. `--popover` appears nowhere in
    `globals.css` and `popover` appears nowhere in `tailwind.config.ts`, so both
    utilities compiled to **nothing at all**, and the panel has been a bordered,
    shadowed rectangle with the page showing straight through it and its own
    text overlapping whatever sat behind. *Fixed: `bg-card text-card-foreground`,
    which is the surface `Popover` and `Dialog` already use and is defined in
    both themes.*

    A sweep for the same failure across all of `src/` — every colour utility used
    anywhere, checked against the compiled stylesheet — found these two and
    nothing else. The rule that catches it: **a colour name that is not in
    `tailwind.config.ts` fails silently.** There is no error, no warning and no
    type. It is worth re-running that check after any token change.

Smaller, same pass: `Badge` gained `align-middle` (it rode 3px low inside a
sentence) and `max-w-full break-words` (it could not shrink inside a narrow table
cell); `StatTile` values gained `break-words tabular-nums` (a formatted count has
no break opportunity in it and widened its own track) and `h-full` (a linked tile
stopped stretching to match its neighbours); `Table`'s wrapper moved from
`overflow-auto` to `overflow-x-auto`; the tab scroller gained
`overscroll-x-contain`, so flicking to the end of a rail no longer hands the
gesture to the browser as a Back navigation.

## 21. The five things pages were hand-rolling

Built because they are genuinely repeated three or more times — counted out of
`src/`, not imagined.

| New | Replaces | Count |
| --- | --- | ---: |
| `SectionHeader` | a hand-styled `<h2>`/`<h3>` plus a description | 38 |
| `FieldGrid` | `grid gap-4 md:grid-cols-2 lg:grid-cols-4` inside a card | 52 `lg:grid-cols-*` |
| `CopyField` | `<code>` + `CopyButton` in a flex row | 8 |
| `DescriptionList` | a hand-written `<dl>` | 8 |
| `Stepper` | `StepRail`, `ChecklistRow`, and the marketing journey | 3 |

`SectionHeader` takes `size` and `level` separately on purpose: how big a heading
looks and where it sits in the document outline are different questions, and
conflating them is why several `<h2>`s currently sit inside a card whose
`CardTitle` is already an `<h2>` — two peers in the outline where there is
visibly one section inside another. `size="eyebrow"` is small, quiet, and still a
real `<h3>`. The 38 hand-written ones use four different type treatments for one
job, and their descriptions are sometimes `text-sm` and sometimes `text-xs`.

`Stepper` is the one the onboarding work should build on. Two variants — `rail`
(compact progress) and `list` (the checklist, with a control per row) — from one
set of statuses, so the two screens describing the same five steps stop
describing them differently. It enforces the rule all three existing copies only
half-kept: **colour is never the only signal.** A completed step is green AND
ticked AND says "Done"; the current one is emphasised AND carries
`aria-current="step"` AND says "Do this next". The number is `aria-hidden`,
because the list already announces "3 of 5".

`CopyField` is a client component; everything else in this group is a server
component and works inside `<form action={serverAction}>` with no JavaScript.

## 22. Left for the owners of those files

Every item below is a call site, not a primitive, and lives in a file this pass
does not own.

- `src/modules/company/components/list-controls.tsx` — delete `inputCls` (lines
  15–18) and use `<Input size="sm" type="text" name="q" … className="w-56" />`.
  The comment above it explaining why it could not use the primitive is now out
  of date.
- `src/app/(dashboard)/company/reports/page.tsx:1390` and `:1404` — two
  hand-rolled `h-9 rounded-md border border-input …` inputs; same fix.
- `src/components/copy-button.tsx` — the silent-failure copy button. Either move
  its call sites to `CopyField`, or port the failure branch into it. Eight files
  import it.
- `src/app/(marketing)/customer-onboarding/page.tsx:254` — step markers, now on
  `bg-primary` after a parallel pass fixed the raw `bg-emerald-100` /
  `bg-blue-100` they used to carry. The colour is right and the measurements are
  a fourth set; `Stepper variant="rail"` is this shape.
- `src/modules/company/components/flow-builder.tsx:803,816` and
  `flow-inspector.tsx:132,143,154` — `size="sm" className="h-7 w-7 p-0"`. Now
  `size="icon-xs"`, and each needs an `aria-label`.
- `src/app/(dashboard)/company/help-desk/page.tsx:895` and
  `helpdesk-chat-preview.tsx` — hardcoded `bg-violet-50` / `text-[#5b3ff4]` /
  `text-slate-*`, which have no dark-mode value. They need tokens; if the helpdesk
  really does want a colour the system does not have, that is a new token and
  should be argued for rather than inlined.
- **Wide tables are not keyboard-scrollable.** A scroll container with no
  focusable child cannot be scrolled by keyboard (WCAG 2.1.1). The fix is
  `tabIndex={0}` plus a real `aria-label` on the wrapper — but only on the few
  tables that genuinely overflow, not on all 35, because each of the others would
  become an unnamed tab stop. Needs deciding per table.
- **`InfoHint` inside a `<TableHead>` will be clipped.** `Table`'s scroller is a
  clipping context on both axes: setting `overflow-x` alone does not help,
  because CSS computes the other axis from `visible` to `auto` whenever its
  partner is not `visible`. No call site does this today — `reports/page.tsx`
  uses it on card headings, which is correct. If one is ever needed, `Popover` is
  already in the system and already portals.

## 23. Two passes reached the same conclusion — converge them

While this pass was running, another produced
`src/modules/company/components/form-layout.ts`, which is the same idea as
`FieldGrid` arrived at independently from the same evidence: viewport
breakpoints lie about containers, and `repeat(auto-fit, minmax(<floor>, 1fr))`
is the honest version. Its file comment reaches the identical diagnosis, down to
naming the clipped `<select>`. That agreement is worth more than either
implementation, and it is also a fork: two ways to lay out a form row is exactly
the "same job, two grammars" problem this whole document exists to close.

**They are not equivalent, and the difference is a live bug.**

`form-layout.ts` uses `minmax(16rem, 1fr)`. A grid track with a fixed `16rem`
floor does not shrink below 256px, so inside a container narrower than that the
grid overflows its parent and the page scrolls sideways. `FIELD_GRID` (16rem) is
usually safe by luck — a 375px phone leaves about 295px of content inside a
card — but `FIELD_GRID_WIDE` (20rem = 320px) is wider than that content box, so
any form using it overflows at 375px. It is live:
`src/modules/company/components/connect-integration-form.tsx:247` uses it for
the two fields holding a URL and a bearer token. `CHOICE_GRID` (17rem = 272px)
is within about 20px of doing the same inside a nested panel, and it has nine
call sites.

`FieldGrid` uses `minmax(min(100%, 16rem), 1fr)`. The `min(100%, …)` clause caps
the floor at the container's own width, so the grid drops to one column instead
of overflowing. It is the whole difference between "responsive" and "responsive
until it isn't".

Suggested convergence, in order of preference:

1. Point `form-layout.ts`'s four constants at `FieldGrid`'s `min` values and
   have call sites use the component, which also carries the `gap` rhythm.
2. Failing that, add the clause in place — `minmax(min(100%,16rem),1fr)`, and the
   same for 20rem, 11rem and 17rem. This is a one-line change per constant and
   removes the overflow whatever else is decided.

`FORM_SECTION_TITLE` / `FORM_SECTION_HINT` in the same file overlap with
`SectionHeader` the same way, and reached the same answer (`text-base
font-semibold`, the majority style). `SectionHeader` additionally renders a real
`<h2>`/`<h3>` with the level stated separately from the size, which a class
constant cannot do — and a missing heading level is invisible until someone
navigates by headings. Prefer the component.
