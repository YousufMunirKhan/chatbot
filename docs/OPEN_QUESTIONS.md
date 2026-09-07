# Open questions for the business

Decisions I cannot make from the code. Each one changes what should be built next, so
they are ordered by how much downstream work they unblock.

Each question states the options and the trade-off. Where the code already implies an
answer, that is noted — an implicit decision is still a decision, and worth confirming
rather than inheriting.

---

## 1. Packaging: does any of this cost extra?

**Today every plan gets everything.** `src/modules/super-admin/plans.ts:18-70` defines
five plans that differ only by message count, assistant count, seat count, integration
count and included AI credit. There is no feature gate anywhere — grep for `planCode` in
the company dashboard returns nothing, and only `botLimit` is enforced in the UI
(`bots/new/page.tsx:33-34`). A £19 Starter customer gets ten channels, the flow builder,
WhatsApp broadcasts, the public API and agency-grade white-labelling.

**Options.**

| Option | Trade-off |
|---|---|
| **A. Leave it open.** Everything on every plan | Simplest, best for a land-grab against Revora, and no build work. But it caps ARPU permanently and makes a later clawback feel like a price rise |
| **B. Gate by channel count.** Website + one messaging app on Starter; unlimited above | Natural upsell tied to real cost. Needs a per-plan `channelLimit` and a gate on `/company/channels` |
| **C. Gate by feature tier.** Flows, broadcasts, automations, API and agency mode become paid features | Highest ARPU, matches how competitors price. Most build work: a capability system that does not exist yet, plus upgrade prompts on ~8 screens |

**What I need:** the target ARPU and whether we are competing on price or on capability.

**Related sub-question — what is a "credit"?** The word appears in the UI
(`auto-topup-form.tsx:55`, "Top up below (credits)") and is never defined for the
customer. Should it be shown as £, as "AI replies", or kept as credits with a one-line
explainer? Note the FX rate and markup are hardcoded — `USD_TO_GBP = 0.8` and
`CUSTOMER_AI_MARKUP = 2.5` at `src/lib/billing/credits.ts:5-6` — so this also decides
whether we ever sell outside the UK.

---

## 2. Which channels do we launch, and which do we quietly shelve?

The approval burden differs by an order of magnitude across the ten, and three are not
actually ready. Announcing all ten and shipping four working ones is worse than
announcing four.

| Channel | Approval burden | Engineering state | My read |
|---|---|---|---|
| Telegram | Minutes. BotFather, no review | Best-implemented channel | **Launch first.** Cheapest proof that multi-channel works |
| Facebook Messenger + comments | Meta App Review, 2–4 weeks | Fully wired | **Launch.** The comment-to-DM flow is the differentiated demo |
| WhatsApp | Meta Business verification + a dedicated number, 1–2 weeks | Works, but text-only (`webhooks/whatsapp/route.ts:95`) | **Launch** — it is what customers ask for — but fix the text-only limit first |
| Instagram DM | Same Meta review | Works, text only | Launch with Messenger |
| Instagram comments | Same | **Never parsed** (`webhooks/instagram/route.ts:38-40`) | **Do not announce** until fixed |
| Viber | Public Account approval, days | Real | Launch if a target market uses it |
| LINE | Messaging API channel, days | Real | Same |
| Email / Gmail | Gmail needs Google verification for restricted scopes — weeks | Real, but outbound needs two undocumented env vars | Launch Gmail OAuth; it is the best onboarding story ("one click, no forwarding rules") |
| TikTok | TikTok for Business + Comment Management access | Comments only; "private DM" silently posts publicly | **Shelve** |
| YouTube | Google OAuth | Token expires hourly with no refresh (`pollers/youtube.ts:45-56`) | **Shelve** |

**The question.** Do we lead with "ten channels" as a parity claim, or with three that
demonstrably work? Parity claims are checkable — a prospect comparing us to Revora will
try Instagram comments.

**A second decision hides inside this one.** Meta App Review is per-app, not per-customer.
Do we (a) run one platform Meta app that every tenant connects through — fast for the
customer, but our app's standing is exposed to every tenant's behaviour, and it is a
single point of suspension; or (b) require each customer to bring their own Meta app —
safe for us, weeks of work for them, and a large share will not finish? The product
currently assumes (b): every field on `/company/channels` asks for tokens the customer
must obtain themselves.

---

## 3. Should comment auto-reply default to on or off?

Today it is **on** — `handler.ts:158` defaults to `private_with_ack` and nothing writes a
`commentReply` key at connect time (`channels-actions.ts:114-116`). So connecting a
Facebook Page immediately starts the AI replying publicly under the shop's own posts.

| Option | Trade-off |
|---|---|
| **On, private + public acknowledgement** (today) | Best demo, immediate value, and the public reply is only an acknowledgement. But the first thing a new customer sees is their brand speaking without review, on a post that may be about a complaint |
| **On, but only after a test comment** | Gate the first live reply behind the owner confirming one sample. Small build, removes the surprise |
| **Off by default** | Safest. Most owners will never find the setting, given it is behind a "Settings & test" toggle on an unlinked page |

**My recommendation, for a decision:** keep it on but add the confirmation step, and put
the choice in the connect form rather than behind a collapsed panel. But this is a brand-
risk judgement, not a technical one — a single bad AI reply under a customer complaint on
a client's own Facebook Page is the kind of thing that ends an account.

**Related:** the default public acknowledgement text is hardcoded — *"Thanks for reaching
out — we just sent you a direct message."* (`channels-data.ts:12`). English only. Should
it be per-company, per-language, or removed?

---

## 4. Who gets the API, and how much of it?

The public API is the strongest asset in the batch — 9 routes, scoped keys, distributed
rate limiting, real tenant isolation, a typed SDK. It is also currently available to every
plan including the free trial, at 120 requests/minute
(`src/lib/api/handler.ts:116`).

| Option | Trade-off |
|---|---|
| **Read-only on all plans; write scopes on paid** | Lets everyone build dashboards; keeps `messages:write` and `broadcasts:write` — the ones with real cost and real abuse potential — behind money |
| **Whole API on Business and above** | Cleanest story, easiest to enforce (`api-keys.ts` already has scopes). Loses the developer-led adoption that makes a platform sticky |
| **Whole API on every plan, rate-limited by tier** | Best adoption. Needs per-plan limits, which `rateLimitDistributed` could carry with a small change |

**A specific sub-question:** `POST /api/v1/broadcasts` lets a key holder send to an entire
contact list. On the free trial. With no 24-hour-window check (see the review). That
combination is a spam vector against our own Meta app standing. Should
`broadcasts:write` require a paid plan regardless of what we decide above?

**And a naming decision that cannot wait:** the SDK ships as `public/sdk/revora.js`,
defines a global `Revora`, and the Developers page tells every customer to set
`REVORA_API_KEY`. That is a competitor's name in customer-facing integration code on a
white-label product. What is the product's own name for developer surfaces — the platform
name, or the agency's? Renaming is trivial now and expensive after the first integration.

---

## 5. Is agency mode for resellers, or for our own multi-brand customers?

The code has not decided. It reads as a reseller feature — the file calls it *"A reseller
('agency') owns a set of sub-account companies and re-brands the product"*
(`src/lib/agency.ts:5-7`) — but nothing charges the reseller. Sub-accounts get full plan
limits with `status: 'active'` and no Stripe subscription
(`agency-actions.ts:116-124`), and the agency console shows aggregate credit but no
invoice and no margin.

There is also a gap that decides itself once you answer this: **no user is ever created
for a sub-account.** The UI says "Invite its team from that company's own Team screen
afterwards" (`agency/page.tsx:84-86`), but nobody can reach that screen, and impersonation
is super-admin only.

| Option | What must be built |
|---|---|
| **Reseller.** Agency buys wholesale, resells at its own price | Agency-level billing, per-sub-account cost roll-up, a margin view, and an invite flow so the agency can hand accounts to clients |
| **Multi-brand.** One company running several brands under one bill | Much less: shared billing is already the behaviour. Mainly needs the invite flow and a way to switch between brands |
| **Managed service.** We onboard, the agency operates | Needs the invite flow plus impersonation for agency owners — currently super-admin only (`impersonation-actions.ts:32`) |

**Also to decide:** becoming an agency is super-admin-only today
(`agencies-actions.ts:70`), with no request form. Is that deliberate gatekeeping — a
sales-qualified motion — or an unfinished self-serve path? If it is deliberate, the
product should say "Talk to us about agency access" somewhere. Right now the feature is
invisible to anyone who does not already have it.

---

## 6. What is the Arabic launch scope?

Two very different things are both called "Arabic support", and they are in very different
states.

- **Customer-facing Arabic is genuinely done.** `src/lib/ai/lang.ts:30-37` detects Arabic
  script *and* Arabizi, the widget has RTL, and the opt-out keyword matrix normalises alef
  forms and tashkeel (`subscriptions.ts:25-36`). An Arabic-speaking customer gets a proper
  experience today.
- **The owner-facing dashboard is roughly 8%.** 221 dictionary keys, matched between `en`
  and `ar`, but only 4 of ~48 company pages call the dictionary, and no component under
  `src/modules/` or `src/components/` uses it at all — so even the four "translated" pages
  render English forms, buttons and validation messages. Everything shipped in this batch
  is English-only.

| Option | Trade-off |
|---|---|
| **A. Ship as "your customers can chat in Arabic."** No dashboard work | Honest, immediately true, and it is the half that matters to a shop's revenue. Weak against a competitor advertising an Arabic admin panel |
| **B. Translate the daily-use screens** — Home, Inbox, Business Data, Setup, Channels | ~4 more pages plus their components. Covers what an owner touches weekly; the yearly settings stay English |
| **C. Full dashboard Arabic** | Large: every component needs the dictionary threaded through, and the dictionary needs roughly 5–10× the keys |

**A bug to fix whichever we choose:** picking "Auto-detect" — the default for
agency-created sub-accounts (`agency-actions.ts:72`) — silently resolves to English
(`i18n/index.ts:39`). An Arabic-speaking owner who chooses the option that sounds right
gets an English dashboard forever.

**And the question behind the question:** is the target market Gulf shop owners who
*prefer* Arabic admin, or Gulf shops whose *customers* write Arabic while the owner works
in English? That determines whether option C is essential or a waste.

---

## 7. Are we the system of record for consent, or is the shop?

The product stores opt-outs (`contact_subscriptions`), honours STOP keywords on inbound,
and skips opted-out contacts on broadcasts. But the store-automation path ignores all of
it (see the review, §1.1), and the 24-hour messaging window is described in six places and
enforced in none.

Fixing the bug is not the question. The question is what we promise:

| Option | Consequence |
|---|---|
| **We enforce compliance.** Block sends outside the 24h window, refuse free-form sends to non-opted-in contacts, rate-limit to the account's Meta tier | Customers cannot get themselves banned through our product. Some will complain that we blocked a send they wanted. Needs a `last_inbound_at` per contact, a tier check before dispatch, and a send queue with pacing |
| **We warn but allow.** Show a red count of "these will probably be rejected" and let them send | Less build, keeps the customer in control, but their number's standing — and our Meta app's, if we run a shared app (see Q2) — is on the line |
| **We record and get out of the way.** The shop is responsible | Cheapest. Untenable if we run a shared Meta app, and a poor look in a GDPR/PDPL market |

This interacts directly with Q2: if we run one platform Meta app, one customer's spam is
everyone's suspension, and option 3 stops being available.

---

## 8. Two smaller decisions that are currently being made by default

**8a. Knowledge documents are published as a public website.** Any document with audience
`customer` or `both` is served at `/help/<publicBotId>`
(`src/modules/help-center/data.ts:35-58`), with no toggle and no mention anywhere in the
dashboard. The bot id is in the widget script tag on the shop's own site, so the address
is discoverable. Is the public Help Center a feature we want to promote — in which case it
needs an entry point, a URL shown to the owner, and an on/off switch — or an accident that
should be gated off by default?

**8b. There are three roles and no permissions.** `super_admin`, `company_admin`, `agent`
(`constants.ts:3-7`). Everything shipped in this batch is admin-only, so a 10-person shop
has one person who can touch flows, channels, broadcasts and billing. There is also no way
to promote someone to admin from the interface — the invite form has no role field. Is a
"manager" role (inbox + flows + reports, no billing) worth building, or is one admin per
account the intended model? This is worth answering before agency mode, because a reseller
managing 20 clients will hit it immediately.
