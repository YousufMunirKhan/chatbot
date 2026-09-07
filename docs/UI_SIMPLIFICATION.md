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
