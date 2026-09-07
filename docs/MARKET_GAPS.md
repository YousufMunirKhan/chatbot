# Market gaps

What competitors and the market expect that this product does not have, and what
could realistically be added next.

**Snapshot: 8 September 2026, working tree at `8d96d9a` (clean).**

Every "missing" claim below was checked by reading the file or the migration
named beside it. Where a check was inconclusive it says **unverified**. Sizes are
S (< 1 day), M (2–5 days), L (> 1 week).

Competitor references are to the well-known feature sets of Intercom, Zendesk,
Tidio, Crisp, Chatbase and ManyChat. **Revora's specific feature list was not
verified in this analysis** — where it appears below it is an assumption based on
the category, not a checked fact.

---

## 0. What already exists — read this before proposing anything

The engineering surface is much wider than a typical product at this stage. The
following are **built and wired**, and a gap list that ignores them will be wrong.

| Area | State | Evidence |
|---|---|---|
| Channels | 9 adapters — WhatsApp, Instagram, Facebook, Telegram, Viber, LINE, TikTok, YouTube, Email/Gmail | `src/lib/channels/adapters/`, `src/lib/channels/types.ts:10-19` |
| Flow builder | Visual canvas, 22 block types, 7 trigger types, versioning, in-browser simulator | `src/modules/company/components/flow-builder.tsx`, `src/lib/flows/`, migration `0053_flow_builder.sql` |
| AI pipeline | 5 providers (openai, anthropic, gemini, deepseek, grok), hybrid RAG + reranker, 26 agentic tools, rolling conversation summary, prompt-injection fence, PII redaction | `src/lib/ai/registry.ts:28`, `src/lib/ai/rag.ts`, `src/lib/tools/index.ts:13`, `src/lib/ai/safety.ts:18` |
| AI insights | 8 deterministic insight rules + an LLM knowledge-gap pass, weekly cron | `src/lib/ai/insights/rules.ts:58-209`, migration `0059_ai_insights.sql`, `vercel.json` |
| Inbox | Real-time (Supabase Realtime), canned responses, internal notes, priority, tags, collision detection, agent presence, round-robin routing | `src/modules/company/inbox-actions.ts`, `src/lib/agent-routing.ts:6`, migrations `0018`, `0040` |
| Reports | 5 tabs — overview, team, customers, assistant, sales — incl. per-agent performance, CSAT, containment, first-contact resolution, busiest-hours heatmap | `src/app/(dashboard)/company/reports/page.tsx:38-64`, `src/modules/company/reports-data.ts` |
| Public API | 7 route groups, 8 scopes + wildcard, SHA-256 key hashing, constant-time compare, Postgres-backed distributed rate limiting, JS SDK | `src/app/api/v1/`, `src/lib/api-keys.ts:33-42`, `supabase/migrations/0020_hybrid_retrieval_scale.sql:83` |
| Service levels | Per-priority/channel targets, business-hours clocks, breach escalation, attainment dashboard | `src/lib/sla/`, migration `0058_sla_policies.sql` |
| WhatsApp suite | Templates (real Meta API), opt-in/opt-out with Arabic keyword normalisation, broadcasts, green-tick + BSP checklists | `src/lib/channels/whatsapp-templates.ts`, `subscriptions.ts:25-83`, migration `0054` |
| Commerce | Shopify + WooCommerce order/shipping/cancellation automations, abandoned-cart recovery, HMAC-verified store webhooks | `src/lib/commerce/`, migration `0055_commerce_automations.sql` |
| Agency / white-label | Sub-accounts, per-agency branding resolved by custom domain on the login page | `src/lib/agency.ts`, migration `0057` |
| Compliance | Right to erasure + erasure log, configurable 1–3650 day retention with a nightly purge cron, impersonation audit trail | `src/modules/company/gdpr-actions.ts:65`, migrations `0041`, `0012:41-70`, `0019` |
| Embeddable connectors | A developer SDK to embed the help desk **inside the customer's own software** — .NET, Android, Web, Node, Laravel, React, Vue | `connectors/README.md`, `connectors/PROTOCOL.md`, migration `0027` |
| Widget | 40 configurable appearance fields, markdown rendering, typing indicator, RTL, AI-triggered inline forms and product cards, per-URL proactive rules | `src/modules/company/widget-design-actions.ts:22-62`, `public/widget/widget.js:955-959`, migration `0043` |
| Integrations with real API clients | Shopify (products/variants/inventory/customers/orders + HMAC webhooks), WooCommerce, Square, Foodics, Google Calendar (real OAuth + freeBusy + event create), Custom API, CSV | `src/lib/integrations/sync.ts:119-448`, `src/lib/helpdesk/managed.ts:5-74`, `src/app/api/integrations/google/start/route.ts:14-22` |
| Scheduling | 7 Vercel cron jobs are committed | `vercel.json` |

**`docs/PRODUCT_REVIEW.md` is partly stale — do not plan from it without
re-checking.** Three of its ten blockers have since been fixed, verified against
the current tree: `vercel.json` now exists with seven cron entries (its §1.2);
`src/app/(dashboard)/layout.tsx:15-18` now imports
`src/components/dashboard-nav-items.ts`, so the sidebar wiring landed (§1.3); and
store automations now delegate to the canonical `isOptedIn`
(`src/lib/commerce/automations.ts:2,131`), so the opt-out query bug is gone
(§1.1). Its §8 "unverified" note about the `rate_limit_hit` RPC is also resolved
— the function does exist
(`supabase/migrations/0020_hybrid_retrieval_scale.sql:83`).

Two caveats on the table above:

- `/api/cron` (integration hourly sync, retention `cleanup_old_chats` via the
  legacy path, the `background_jobs` queue, improvement emails) is **not** in
  `vercel.json`, and it is POST-only with a JSON body, which Vercel cron cannot
  send (`src/app/api/cron/route.ts:16`). Store product/stock data therefore never
  re-syncs on a schedule. `enqueueJob` (`src/lib/jobs.ts:5`) has no callers at
  all.
- Three shipped surfaces are still inert: `src/lib/groups.ts` runtime helpers
  have no importers (only the `ContactType` type is imported, by
  `src/modules/company/groups-data.ts:2`); `src/lib/channels/whatsapp-catalog.ts`
  is referenced only by `scripts/test-whatsapp-suite.mjs`; and the Google
  sign-in button `src/app/(auth)/login/google-button.tsx` is never imported by
  anything. The `integration_accounts.provider` enum also advertises `pos` and
  `crm` (`supabase/migrations/0008_integrations.sql:9`) with no branch in
  `src/lib/integrations/sync.ts:572-573`, so choosing either silently no-ops.
  Four module directories are empty scaffolding: `src/modules/widget/`,
  `src/modules/integrations/`, `src/modules/inbox/`, `src/modules/knowledge/`.

---

## Tier 1 — Table stakes we lack

Ranked by value ÷ effort. These are the ones that lose deals.

| # | Gap | Size |
|---|---|---|
| 1.1 | Self-serve signup and trial | S/M |
| 1.2 | Assign or transfer a conversation to a teammate | S |
| 1.3 | Inbox filters beyond the six fixed queues | S |
| 1.4 | Snooze / follow-up reminders | S |
| 1.5 | Answer citations in the widget | S |
| 1.6 | Company-visible audit log | S |
| 1.7 | Self-serve billing management (portal, invoices, cancel) | S |
| 1.8 | Custom date ranges and scheduled reports | S |
| 1.9 | Role selector on invites, and granular permissions | S/M |
| 1.10 | File and image attachments, both directions | M |
| 1.11 | An AI copilot for the human agent | M |
| 1.12 | A knowledge base that can ingest a real business | M |
| 1.13 | A first-class contact record | M/L |
| 1.14 | Feature entitlements per plan | M |
| 1.15 | A Help Center that is actually a help centre | M |
| 1.16 | SSO, and 2FA a security reviewer accepts | M (SAML L) |
| 1.17 | SMS | M |
| 1.18 | A native Zapier / Make app | M |
| 1.19 | Widget basics: pre-chat form, out-of-hours, returning-visitor history | S each |
| 1.20 | Widget accessibility, and a non-blocking script tag | S |

### 1.1 Self-serve signup and trial — **S/M**

**What it is.** A prospect can create an account and start a trial without a
human.

**Evidence it is missing.** There is no `/signup` or `/register` route —
`src/app/(auth)/` contains only `login`, `forgot-password`, `reset-password` and
the OAuth `callback`. `src/app/page.tsx` is three lines and redirects `/` to
`/login`. `companies` rows are inserted in exactly two places:
`src/modules/super-admin/actions.ts:111` (super-admin) and
`src/modules/company/agency-actions.ts:100` (an agency creating a sub-account).

**Who has it.** All of them. Chatbase, Tidio and Crisp are entirely
product-led.

**Builds on.** `createCompanyAction` in `src/modules/super-admin/actions.ts` is
already the whole tenant-provisioning routine; `billing_plans` already carries
`free_trial` with `trial_days = 14`
(`supabase/migrations/0025_billing_plans_and_stripe_settings.sql:35`);
`stripe_price_mappings` + `src/app/api/billing/checkout/route.ts` already do
self-serve upgrade; `/company/setup` is already a first-run checklist.

**Note.** This is the single highest-leverage item on the list. Every marketing
pound spent today lands on a login form.

---

### 1.2 Assign or transfer a conversation to a teammate — **S**

**What it is.** Hand a conversation to a named colleague.

**Evidence it is missing.** The only write to `assigned_agent_id` from the inbox
is implicit self-assignment when an agent replies
(`src/modules/company/inbox-actions.ts:119`). Greps for
`assignConversation|reassign|unassign|assignAgent` return only report labels
(`src/app/(dashboard)/company/reports/page.tsx:433`). A flow can assign
(`src/lib/flows/runtime.ts:269`); a human cannot.

**Who has it.** Every helpdesk ever shipped.

**Builds on.** `conversations.assigned_agent_id`, the `agent_presence` table
(`supabase/migrations/0018_production_scale.sql:54-57`),
`src/lib/agent-routing.ts:6` (already lists eligible agents), and
`src/modules/company/components/ticket-panel.tsx`, which is the obvious place to
put the control.

---

### 1.3 Inbox filters beyond the six fixed queues — **S**

**What it is.** Filter by channel, by another agent, by tag, by date.

**Evidence it is missing.** `src/modules/company/inbox-data.ts:380-414` defines
exactly six queues — `waiting`, `mine`, `urgent`, `poor`, `closed`,
`everything`. No channel, assignee, tag or date predicate exists. Search is
`ILIKE '%term%'` over `conversations.visitor_id`, `leads.name/email/phone` and
`messages.content_text` (`inbox-data.ts:334-367`), with no full-text index —
`tsvector` exists only on `chunks` (`0006_knowledge_rag.sql:45`) and
`synced_products` (`0009_structured_business.sql:36`).

**Who has it.** Intercom, Zendesk, Crisp, Tidio — all with saveable views.

**Builds on.** The queue switch in `inbox-data.ts` is a single `switch`; the
columns (`channel`, `assigned_agent_id`, `tags`, `created_at`) all already exist
on `conversations`.

---

### 1.4 Snooze / follow-up reminders — **S**

**What it is.** Park a conversation until Tuesday.

**Evidence it is missing.** `snooze|remind_at|remind me` appears nowhere in
`src/`, `supabase/migrations/` or `public/`. The status enum is
`ai_active, needs_human, human_active, closed, expired`
(`supabase/migrations/0015_realtime_quality_agents.sql:48`).

**Who has it.** Intercom, Zendesk (as "pending"/"on-hold"), Front, Crisp.

**Builds on.** One column plus one predicate in the queue switch
(`inbox-data.ts:380`), and a wake-up sweep that can ride the existing
`/api/cron/sla` minute cron.

---

### 1.5 Answer citations in the widget — **S**

**What it is.** Show the customer (and the owner testing it) which document an
answer came from.

**Evidence it is missing.** `src/lib/ai/rag.ts:195` numbers the retrieved
context as `[1] …` **for the model only**. The chat SSE event types are
`meta`, `token`, `status`, `action`, `blocks`, `human`, `error`, `done`
(`src/app/api/chat/route.ts:168-616`) — there is no `sources` event, and
`public/widget/widget.js` renders no citation.

**Who has it.** Chatbase, Intercom Fin, Zendesk AI agents — it is the standard
trust device for a RAG bot, and the first thing a buyer asks about hallucination.

**Builds on.** `rag.ts` already has the ranked chunks with `document_id`; the
SSE action channel (`emitAction` in `src/app/api/chat/route.ts:552`) already
carries structured payloads to the widget; `renderInlineAction` in
`public/widget/widget.js` already renders structured blocks.

---

### 1.6 Company-visible audit log — **S**

**What it is.** "Who changed the assistant's prompt last Thursday?"

**Evidence it is missing.** Company actions write `audit_logs`
(`src/modules/company/actions.ts:412,441`,
`src/modules/company/helpdesk-actions.ts:200,265,312`) but the only readers are
`src/modules/super-admin/data.ts:578,609` →
`src/app/(dashboard)/super-admin/audit-logs/page.tsx:14`. The company security
page shows the **current user's own** sign-in events only —
`src/modules/company/security-data.ts:16-21` filters `.eq('user_id',
user.userId)` on `security_audit_logs`.

**Who has it.** Zendesk, Intercom (paid tiers), and every tool sold to a team of
more than three.

**Builds on.** The rows already exist; this is a read query, an RLS policy and a
page.

---

### 1.7 Self-serve billing management — **S**

**What it is.** See invoices, change the card, cancel, download a VAT receipt.

**Evidence it is missing.** The only Stripe surfaces are
`checkout/sessions` (`src/app/api/billing/checkout/route.ts:60`) and a webhook
handling four event types (`src/app/api/webhooks/stripe/route.ts:41,63,73`).
No `billingPortal` / `billing_portal` anywhere. Auto top-up asks the owner to
paste a raw `pm_…` payment-method id
(`src/modules/company/components/auto-topup-form.tsx:88-98`) — an ordinary shop
owner cannot obtain one.

**Who has it.** Everyone, because Stripe gives it away.

**Builds on.** The Stripe secret and customer id are already stored and used by
`api/billing/checkout/route.ts`. A Billing Portal session is one API call and one
link.

---

### 1.8 Custom date ranges and scheduled reports — **S**

**What it is.** "Last month" and "email me this every Monday."

**Evidence it is missing.** `const RANGES = [7, 30, 90]`
(`src/app/(dashboard)/company/reports/page.tsx:36`), coerced at `:1089`, with the
same list re-declared in `src/app/api/company/reports/export/route.ts:17`.
`/company/usage` is hardcoded to calendar-month-to-date
(`src/modules/company/analytics-data.ts:30`). No scheduled-report code and no
report cron in `vercel.json`.

**Who has it.** Zendesk Explore, Intercom Reports, Tidio Analytics.

**Builds on.** The report readers already take a day window
(`src/modules/company/reports-data.ts`); the CSV writer already exists
(`reports-metrics.ts:341-351`); the weekly `/api/cron/insights` job is the
template for a scheduled send.

---

### 1.9 A role selector on invites, and granular permissions — **S/M**

**What it is.** A second admin. A billing-only finance user. An inbox-only agent
who cannot see leads.

**Evidence it is missing.** `src/modules/company/actions.ts:395` hardcodes
`role: ROLES.AGENT`, the invite form has Name and Email only
(`src/modules/company/components/agent-invite-form.tsx:17-27`), and the invite
table constrains it in the database —
`role text not null default 'agent' check (role in ('agent'))`
(`supabase/migrations/0015_realtime_quality_agents.sql:55`). A ten-person shop
has exactly one person who can touch flows, channels, broadcasts and billing.

**Who has it.** All of them.

**Builds on.** The plumbing is already in the schema and unused: a `permissions`
reference table with ten seeded keys
(`supabase/migrations/0002_core_multitenant.sql:38-55`) and
`company_users.permissions_json jsonb` (`:97`). I grepped `permissions_json`
across `src/` — **zero readers**. So the data model for granular permissions was
designed and never connected.

---

### 1.10 File and image attachments, in both directions — **M**

**What it is.** A customer sends a photo of the broken part; an agent sends the
warranty PDF.

**Evidence it is missing.** `public/widget/widget.js` (85,278 bytes) has no
`<input type="file">` and no upload path. The agent reply schema accepts a text
string only (`src/modules/company/inbox-actions.ts:17-20`). Most importantly,
**no object storage is used anywhere in the product** — a grep for
`storage.from`, `createBucket` and `.storage` across `src/` returns nothing.
Uploaded knowledge files are parsed to text and the original discarded
(`src/modules/company/knowledge-actions.ts:170`).

The schema is ready and unused: `messages.content_type` already permits
`'audio','image','file'`
(`supabase/migrations/0005_conversations.sql:41-42`), and the Meta adapter
already parses inbound attachments into a typed shape
(`src/lib/channels/adapters/meta.ts:50-59`) that the live Instagram/WhatsApp
routes then drop.

**Who has it.** All of them. On WhatsApp it is not optional — customers send
photos by reflex.

**Builds on.** Supabase Storage (in the stack, unused), `messages.content_type`,
`adapters/meta.ts` attachment parsing, and the block renderer in
`public/widget/widget.js`.

---

### 1.11 An AI copilot for the human agent — **M**

**What it is.** "Suggest a reply", "summarise this thread", "make this
friendlier", "translate my English into their Arabic".

**Evidence it is missing.** A rolling conversation summary is computed and stored
(`src/lib/ai/engine.ts:250` → `conversations.summary`) but is never rendered in
`/company/inbox/[id]`. Greps for suggested-reply, rephrase or copilot behaviour
in the inbox return nothing; `agent-reply-form.tsx` is a textarea with
Enter-to-send (`:42-47`).

**Who has it.** Intercom Copilot, Zendesk AI, Crisp MagicType, Tidio Reply
Assistant. In 2026 this is table stakes, not a differentiator.

**Builds on.** `previewAnswer` (`src/lib/ai/preview.ts:21`) already runs the full
provider + business-facts + RAG + tool loop and saves nothing — it is *already* a
suggest-reply endpoint with the wrong name. Plus `rag.ts`, the stored summary,
`src/lib/ai/lang.ts` (Arabic + Arabizi detection) and
`src/modules/company/components/agent-reply-form.tsx`.

---

### 1.12 A knowledge base that can ingest a real business — **M**

**What it is.** Point at a website and get the whole site; point at a PDF manual
and get the whole manual; recrawl weekly.

**Evidence it is missing.** Upload caps are three files, 5 MB, **10 PDF pages**
and **20,000 characters**
(`src/modules/company/knowledge-actions.ts:19-22`). The website importer
(`importWebsiteOnboardingAction`, `:290`) fetches the home page plus same-domain
links from it — **max 8 pages, one hop deep** (`:320-328`) — and merges them all
into a *single* document, so a page cannot be refreshed or deleted individually.
There is no `sitemap` or `robots.txt` handling anywhere in `src/` or
`supabase/`. No recrawl job exists in `vercel.json`, and no `next_crawl_at`-style
column exists in `0006`, `0020` or `0042`. No import from Notion, Google Drive,
Zendesk, Intercom, Confluence or Freshdesk (grepped; zero hits).

**Who has it.** Chatbase crawls whole sites and sitemaps and recrawls on a
schedule; Intercom and Zendesk ingest entire existing help centres. A prospect
migrating from Zendesk cannot bring their articles with them.

**Builds on.** `fetchReadablePage` and `extractSameDomainLinks` in
`knowledge-actions.ts:33,96`, the chunk/embed pipeline `src/lib/ai/ingest.ts:8`,
the `background_jobs` table + `processDueJobs` (`src/lib/jobs.ts:34`) that
already exist and have no producer, and Supabase Storage for the original files.

---

### 1.13 A first-class contact record — **M/L**

**What it is.** One page per human being, with everything they have ever done.

**Evidence it is missing.** **There is no `contacts` table.** Contacts are
`leads` (`supabase/migrations/0007_leads_appointments.sql:5`) and
`synced_customers` (`0009_structured_business.sql:7`); the public API says so out
loud — `src/app/api/v1/contacts/route.ts:18` comments *"Contacts are the `leads`
table"* and queries `.from('leads')` at `:38`. `/company/customers` is a
counts-and-links hub, not a contact list
(`src/modules/company/customers-data.ts:19-23`).

Consequently missing: custom attributes on a contact (`leads` is a fixed column
set with no jsonb, `0007:5-20`); contact tags (tags exist on *conversations*
only, `0018:73`); contact notes (`conversation_internal_notes.conversation_id` is
NOT NULL, `0018:67`); a cross-channel timeline (`getConversationDetail` joins one
lead to one conversation, `inbox-data.ts:629-635`); identity merging (
`channel_identities`, `0044:14`, maps *channel address → tenant*, not
person→person); B2B account grouping (no `accounts`/`organizations` table);
lead CSV import (the CSV importer inserts into `synced_customers`, not `leads` —
`src/lib/integrations/csv.ts:109`).

**Who has it.** Intercom (People + Companies), Zendesk (Users + Organizations),
Crisp (CRM), Tidio. This is the difference between a chat widget and a customer
platform.

**Builds on.** `leads`, `synced_customers`, `contact_groups` /
`contact_group_members` (`0057:72,85`), `contact_subscriptions` (`0054:60`), and
`src/lib/groups.ts` — whose three runtime helpers currently have **no
importers** and would find their first consumer here.

---

### 1.14 Feature entitlements per plan — **M**

**What it is.** A £19 Starter customer should not get the flow builder, ten
channels, WhatsApp broadcasts, the public API and agency white-labelling.

**Evidence it is missing.** Greps for `planCode`, `featureGate`, `hasFeature` and
`entitlement` across `src/` return **zero hits**. `billing_plans`
(`supabase/migrations/0025_billing_plans_and_stripe_settings.sql:8-27`) carries
only quantity limits — `message_limit`, `bot_limit`, `agent_limit`,
`integration_limit`, `included_credit_gbp`. The most obvious thing to sell is
already given away: any company admin can blank the widget's "powered by" footer
as free text (`src/modules/company/widget-design-actions.ts:38,110`,
`src/app/api/widget/config/route.ts:109`), and the one real branding gate that
exists — `hidePoweredBy` (`src/lib/agency.ts:29`) — keys off *owning an agency*,
not off a billing tier.

**Who has it.** All of them — it is how they price.

**Builds on.** One `features_json jsonb` column on `billing_plans`, a
`can(feature)` helper beside `requireRole` in `src/lib/auth/index.ts:191-208`,
and upgrade prompts on the roughly eight screens that would be gated. Note this
is a *pricing decision first* — see `docs/OPEN_QUESTIONS.md` §1.

---

### 1.15 A Help Center that is actually a help centre — **M**

**What it is.** A branded, searchable, categorised, indexable article site.

**Evidence it is missing.** `src/app/help/[publicBotId]/page.tsx` renders a flat
list of up to 200 documents with a coloured header and a "Powered by" footer.
`src/modules/help-center/data.ts:35-58` selects `documents` where
`audience in ('customer','both')` and `status = 'ready'` — there is no search, no
category, no ordering control and no article editor (articles are whatever was
ingested into the KB). There is no `robots.ts` or `sitemap.ts` anywhere under
`src/app`, and the page is `dynamic = 'force-dynamic'`, so it is not indexable in
any useful way. No custom domain — `custom_domain` exists only on `agencies`
(`src/lib/agency.ts:177`). And nothing in the dashboard ever shows the owner the
URL: the only `/help/` link in the codebase is inside the help centre itself
(`src/modules/help-center/help-center-list.tsx:42`).

**Who has it.** Zendesk Guide, Intercom Articles, Crisp Helpdesk, Tidio. Self-serve
deflection is half the value proposition of a support product, and it is also
free SEO the customer will pay for.

**Builds on.** `documents` + `chunks` (the KB already has full-text `tsv`,
`0006:45`, so search is a query away), `documents.language` (`0042:9`) for a
per-language help centre, and the agency `custom_domain` resolution already
working on the login page (`src/app/(auth)/login/page.tsx:19`).

---

### 1.16 SSO, and 2FA that a security reviewer accepts — **M** (SAML **L**)

**What it is.** Google Workspace / Microsoft sign-in, and TOTP.

**Evidence it is missing.** No `saml`, `oidc`, `okta` or `azure` anywhere in
`src/`. A Google OAuth button component exists at
`src/app/(auth)/login/google-button.tsx:18` but **nothing imports it** — the
login page composes only `BrandedLogin` and `LoginForm`
(`src/app/(auth)/login/page.tsx:2,34`), so Google sign-in is dead code, not a
feature. Two-factor is an emailed code, and the database forbids anything else:
`two_factor_method text ... check (two_factor_method in ('email'))`
(`supabase/migrations/0018_production_scale.sql:7-17`).

Two adjacent holes found while checking: there is **no session revocation** —
removing a teammate deletes the `company_users` row
(`src/modules/company/actions.ts:433-450`) but never calls
`auth.admin.signOut`, so their session keeps working; and there is no IP
allowlist for the dashboard (IPs are recorded in
`security_audit_logs.ip_address` and never enforced).

**Who has it.** Intercom, Zendesk, Crisp — usually on a business tier, which is
exactly the tier this product wants to sell.

**Builds on.** Supabase Auth already supports both Google OAuth (the button is
written) and TOTP factors; the 2FA challenge flow, cookie and 12-hour re-check
already exist (`src/lib/auth/index.ts:129-133`,
`src/app/(auth)/actions.ts:127`). Widening one CHECK constraint and importing one
component is most of the Google + TOTP work.

---

### 1.17 SMS — **M**

**What it is.** A text-message channel.

**Evidence it is missing.** `CHANNEL_KEYS` in `src/lib/channels/types.ts:10-19`
lists nine channels and `sms` is not among them. `sms` appears only as a display
label (`src/lib/constants.ts:204`, `src/lib/labels.ts:232`) and as a broadcast
option in a form that the channel layer cannot serve
(`src/modules/company/components/whatsapp-settings-forms.tsx:117`). The Twilio
route that exists is WhatsApp-over-Twilio, not SMS — it requires
`settings.provider === 'twilio'` on a `channel_identities` row whose channel is
`'whatsapp'` (`src/app/api/webhooks/twilio/route.ts:47`). The i18n string
`src/lib/i18n/en.ts:305` advertises SMS to customers; it does not exist.

**Who has it.** ManyChat, Tidio, Zendesk, Intercom, Twilio-based everything.

**Builds on.** The adapter contract (`src/lib/channels/types.ts`) — nine
implementations prove the pattern; the existing Twilio credential handling; and
`contact_subscriptions`, whose CHECK **already allows `'sms'`**
(`supabase/migrations/0054_whatsapp_suite.sql:64`).

---

### 1.18 A native Zapier / Make app — **M**

**What it is.** A listed app in the Zapier and Make directories with triggers and
actions.

**Evidence it is missing.** Zapier appears in the product only as prose telling
the customer to point a *generic* webhook at it
(`src/app/(dashboard)/company/webhooks/page.tsx:363-365`,
`src/lib/webhooks.ts:9`). There is no Zapier integration definition anywhere in
the repo.

**Who has it.** All of them, and it is the cheapest distribution channel a SaaS
product has — the directory listing is itself lead generation.

**Builds on.** This is the least work per unit of value on the list, because the
hard part is already done: nine REST endpoints under `src/app/api/v1/`, eight
scopes (`src/lib/api-keys.ts:33-42`), signed outbound webhooks
(`src/lib/webhooks.ts:161-175`) and a subscription table
(`supabase/migrations/0056_public_api.sql:83-90`). The blocker is a naming
decision, not code — see 2.8.

---

### 1.19 The widget's missing basics: pre-chat form, out-of-hours, returning-visitor history — **S each**

**What it is.** Three separate omissions that a buyer notices in the first
five minutes of a trial.

**Evidence they are missing.**

- *Pre-chat form.* Grepping `prechat|pre_chat|pre-chat` in
  `public/widget/widget.js` returns nothing. The only forms are AI-triggered
  mid-conversation (`public/widget/widget.js:634-637`), so a visitor who
  abandons the chat before the model decides to ask leaves no contact detail at
  all.
- *Out-of-hours.* **Partly there, and worth crediting:** quick-action buttons
  can be scoped `during_hours` / `after_hours` / `any` and are filtered live by
  `matchesBusinessHours` (`src/lib/quick-actions.ts:205`, reached from
  `src/app/api/widget/config/route.ts:4`). What is missing is everything else —
  the online/offline text is a static `offlineLabel` string
  (`public/widget/widget.js:112,546`), so the widget never says *when* the shop
  reopens, and there is no leave-a-message form to fall back to. The bot still
  answers, which is the right default; it just answers as though the shop were
  open.
- *Returning-visitor transcript.* The visitor is identified by a `localStorage`
  UUID (`public/widget/widget.js:63,79-85`) and `conversationId` persists
  (`:768-769`), so the thread continues correctly **server-side** and the agent
  sees one thread. But nothing restores it on screen: a history endpoint exists
  (`src/app/api/chat/messages/route.ts`) and returns only `agent` and `system`
  messages (`:48`), never the visitor's own or the AI's, and the widget does not
  call it at all — the only chat fetches in `public/widget/widget.js` are
  `/api/chat` (`:1508`) and `/api/chat/realtime` (`:1297`). On reload the
  customer sees an empty box and, reasonably, re-asks everything.

**Who has it.** Pre-chat forms and persistent transcripts are in Tidio, Crisp,
Intercom, Zendesk and the free tier of most of them.

**Builds on.** `src/lib/business-hours.ts` and the quick-action business-hours
filter that already runs on every widget config load; the inline-form renderer
already in the widget (`renderInlineAction`); and
`src/app/api/chat/messages/route.ts`, which needs one widened `sender_type`
filter and one caller.

---

### 1.20 Widget accessibility, and a script tag that does not block the page — **S**

**What it is.** The widget should not fail an accessibility audit or slow the
customer's site down.

**Evidence it is missing.** `public/widget/widget.js` is **85,278 bytes,
unminified**, and the embed snippet the dashboard hands the customer is a plain
blocking `<script>` with no `async` or `defer` —
`src/app/(dashboard)/company/widget/page.tsx:67` and
`src/app/(dashboard)/company/bots/[id]/settings/page.tsx:48`. There is no
minification step for it in `package.json`.

On accessibility: six `aria-label`s exist
(`public/widget/widget.js:324,347,375,380,531,1404`) and **no `role=` attributes
at all**, no `aria-live` on the message list, no focus trap and no explicit
keyboard navigation. `prefers-reduced-motion` is honoured (`:185`); dark mode is
not (`prefers-color-scheme` returns zero hits).

**Who has it.** All of them, and Intercom and Zendesk both publish VPAT/ACR
documents. Since the European Accessibility Act came into force this is
procurement paperwork, not a nicety: a customer selling to EU consumers can be
asked to evidence it, and our widget is on their page.

**Builds on.** Nothing new — this is two attributes on a script tag, a minify
step, and a pass over the existing DOM builders in `widget.js`. It is the
cheapest item in this document and it improves every customer's Core Web Vitals
at the same time.

---

## Tier 2 — Differentiators we could add

Ranked by value ÷ effort. Each names the existing code that makes it cheap.

| # | Opportunity | Size |
|---|---|---|
| 2.1 | No-code custom AI actions | M |
| 2.2 | Close the loop from knowledge gap to published article | M |
| 2.3 | Auto-translate for agents | S/M |
| 2.4 | Channel health and delivery observability | S/M |
| 2.5 | Sentiment and automatic topic tagging | M |
| 2.6 | Per-company model choice and bring-your-own key | S/M |
| 2.7 | Compliance-grade messaging (24h window, send pacing) | M |
| 2.8 | Make the public API a product | S/M |
| 2.9 | Visitor and customer context in the inbox | S/M |
| 2.10 | A two-way Slack inbox | M |
| 2.11 | Agency reseller economics | M/L |
| 2.12 | Voice / phone | L |
| 2.13 | "Bring your Zendesk with you" — a migration importer | M |
| 2.14 | An integrations directory, and a Shopify App Store listing | M each |

### 2.1 No-code custom AI actions — **M**

**What it is.** The owner describes an action in the dashboard — "look up a
booking: POST to this URL with these fields" — and the assistant can call it.

**Why we are close.** The tool layer is already schema-driven: 26 tools in
`src/lib/tools/index.ts:13` with JSON-schema definitions (`src/lib/tools/types.ts`)
consumed by a provider-agnostic loop (`runToolLoop`, `src/lib/ai/agent.ts`). The
*execution* half also already exists twice over — the flow `http` block does
templated URLs, headers, body and response mapping
(`src/lib/flows/engine.ts:425`, editor at
`src/modules/company/components/flow-inspector.tsx:619-641`), and
`helpdesk_connectors` already stores a per-action `schema_json`
(`supabase/migrations/0027_helpdesk_connectors.sql`). What is missing is
registering a company-defined action *as a tool the model can choose*, rather
than as a deterministic graph step.

**Who has it.** Chatbase ships this as its headline feature. Intercom's
equivalent is enterprise-priced.

**Why it matters here.** It converts every "can it talk to our system?" sales
conversation from a services engagement into a form.

---

### 2.2 Close the loop from knowledge gap to published article — **M**

**What it is.** "37 people asked about parking and we could not answer. Here is
a drafted article — publish it?"

**Why we are close.** Detection already works, in two independent places:
`inferFailureReason` classifies `missing_info` / `weak_retrieval` per answer
(`src/lib/ai/quality.ts:38`, written to `answer_quality_logs` at `:179-206`);
the Quality Room already groups repeat unanswered questions into to-dos
(`src/modules/company/suggestions-data.ts:57-60,147-172`); and the weekly
insights run already themes them with an LLM
(`src/lib/ai/insights/index.ts:89,187-198`). Every one of those currently ends
in a link to `/company/business-data`. The ingest pipeline on the other side is
`src/lib/ai/ingest.ts`. The missing piece is the generate-and-review step
between them — greps for `auto.?draft|generateArticle|draft.?article` return
nothing.

**Who has it.** Intercom has content suggestions; almost nobody in the SMB tier
does. This is the most defensible thing on the list, because it compounds: the
bot gets better on its own and the owner sees it happening.

---

### 2.3 Auto-translate for agents — **S/M**

**What it is.** The customer writes Arabic, the agent reads English, types
English, and the customer receives Arabic.

**Why we are close.** `src/lib/ai/lang.ts:30-37` already detects Arabic script
*and* Arabizi. Five providers are already wired
(`src/lib/ai/registry.ts:28`). The reply box is one component
(`src/modules/company/components/agent-reply-form.tsx`). Nothing else is needed.

**Who has it.** Intercom and Zendesk have it; neither is good at Gulf Arabic or
Arabizi, and this codebase already is (`src/lib/channels/subscriptions.ts:25-36`
normalises alef forms and tashkeel for opt-out keywords).

**Why it matters here.** This is the clearest wedge in the target market: a Gulf
shop whose customers write Arabic and whose owner works in English is the exact
account this product is built for (`docs/OPEN_QUESTIONS.md` §6).

---

### 2.4 Channel health and delivery observability — **S/M**

**What it is.** A badge that says "Instagram stopped working four days ago", and
an alert the first time it happens.

**Why we are close.** `channel_identities` has no health column at all
(`supabase/migrations/0044_channel_identities.sql:14-24`) and
`listChannelIdentities` selects only `created_at`
(`src/modules/company/channels-data.ts:74`) — but the pattern is already built
next door: `supabase/migrations/0035_connector_delivery_observability.sql`, and
the help-desk page already renders a `lastEventLatencyMs` badge with a dry-run
probe (`testConnectorAction`). `src/lib/channels/probe.ts` exists.
Notification delivery already has four transports
(`src/lib/notification-delivery.ts:8`).

**Who has it.** Almost nobody does it well at this price point. Tokens expire
silently everywhere — YouTube's expires hourly with no refresh
(`src/lib/channels/pollers/youtube.ts:45-56`).

---

### 2.5 Sentiment and automatic topic tagging on conversations — **M**

**What it is.** Every conversation lands tagged with what it was about and how
the customer felt.

**Why we are close.** `sentiment` appears nowhere in `src/` or
`supabase/migrations/` — but the two halves exist. Topic extraction already runs
(`src/lib/ai/insights/evidence.ts:167-173` produces `topics: [{term,
conversations}]` using the tokenizer from `src/lib/flows/nlu.ts`), and
`conversations.tags text[]` already exists and is already rendered in the inbox
(`supabase/migrations/0018_production_scale.sql:73`,
`ticket-panel.tsx:104`). Today the topics are computed for a weekly report and
thrown away rather than written back to the row.

**Who has it.** Intercom (Topics), Zendesk (Intelligence). It is what makes
reporting actionable rather than decorative.

---

### 2.6 Per-company model choice and bring-your-own key — **S/M**

**What it is.** "We're on Azure OpenAI / we want Claude / here is our own key."

**Why we are close.** Five providers are already implemented across three adapter
families (`src/lib/ai/registry.ts:28`, `:11`) and per-turn escalation to a
stronger model already exists (`src/lib/ai/model-routing.ts:37`). The only
reason a tenant cannot choose is that provider, model and key are read from
**global** `platform_settings` (`src/lib/ai/providers/index.ts:60-77`, seeded
`0002_core_multitenant.sql:184-189`) and set only in super-admin
(`src/modules/super-admin/components/platform-settings-forms.tsx:152-159`). The
company AI page is a spending cap and nothing else
(`src/app/(dashboard)/company/ai-controls/page.tsx:20`).

**Who has it.** Chatbase exposes model choice on every plan. BYO-key is a common
enterprise procurement requirement.

**Also worth noting:** BYO-key changes the unit economics — a tenant on their own
key costs us nothing, which makes an otherwise unprofitable high-volume account
viable.

---

### 2.7 Compliance-grade messaging: the 24-hour window and send pacing — **M**

**What it is.** "You cannot get your WhatsApp number banned by using our
product."

**Why we are close.** Consent itself is now in good shape, and
`docs/PRODUCT_REVIEW.md` §1.1 is **stale on this point** — re-verified against the
current tree. The data model is `contact_subscriptions` with
`contact_identifier` and `opted_in`
(`supabase/migrations/0054_whatsapp_suite.sql:60-72`); the keyword engine is
genuinely good, including Arabic alef/tashkeel normalisation
(`src/lib/channels/subscriptions.ts:25-83`); store automations now delegate to
the canonical `isOptedIn` (`src/lib/commerce/automations.ts:2,131`); and
broadcasts exclude opted-out contacts whatever the audience
(`src/lib/channels/broadcast-audience.ts:79`).

**What is actually left.** The **24-hour service window is still enforced
nowhere.** Grepping `last_inbound|lastInbound` across `src/` returns a single
comment (`src/modules/company/broadcasts-actions.ts:18`) — no column, no check,
no read. There is also no Meta messaging-tier pacing before dispatch (the tier is
displayed on `/company/whatsapp` and never consulted), the broadcast cron still
carries a private second copy of the consent read
(`src/app/api/cron/broadcasts/route.ts:148-167`), and two of the canonical
helpers — `listOptedOut` and `listOptedIn`
(`src/lib/channels/subscriptions.ts:146,159`) — still have no importers.

**Who has it.** The BSPs (360dialog, Wati, Gupshup) sell exactly this assurance.
Nobody in the SMB chatbot tier offers it, and it becomes mandatory the moment we
run a shared Meta app (`docs/OPEN_QUESTIONS.md` §2, §7).

---

### 2.8 Make the public API a product — **S/M**

**What it is.** Rename it, publish the docs at a URL, add per-plan rate limits,
list it on Zapier.

**Why we are close.** The API is the best-built thing in the repository — 7 route
groups under `src/app/api/v1/`, 8 scopes plus a wildcard
(`src/lib/api-keys.ts:33-42`), SHA-256 hash-only key storage with constant-time
compare (`:101-124`), and genuinely distributed rate limiting via the
`rate_limit_hit` Postgres RPC, which **does** exist
(`supabase/migrations/0020_hybrid_retrieval_scale.sql:83`, called at
`src/lib/ratelimit.ts:42` — this was listed as unverified in
`docs/PRODUCT_REVIEW.md` §8 and is now confirmed).

**Two things block it.** The SDK is named after a competitor —
`public/sdk/revora.js`, the global `Revora`, and `REVORA_API_KEY` rendered to
every customer at `src/app/(dashboard)/company/developers/page.tsx:48-52`. And
the reference lives at `docs/PUBLIC_API.md`, which the Developers page links to
(`:216`) but a customer cannot open, because it ships only in the git repo.

---

### 2.9 Visitor and customer context in the inbox — **S/M**

**What it is.** The agent sees who they are talking to: the page they are on,
where they came from, their device, their last three orders.

**Why we are close.** Only `pageUrl` is captured today
(`public/widget/widget.js:507`, stored as `messages.metadata_json.pageUrl` at
`src/app/api/widget/actions/submit/route.ts:103` and `leads.source_page`,
`0007:15`). Referrer, user agent, device and geo are not captured anywhere
(grepped `referrer|userAgent|device|country|geo` across the chat and widget
routes — no hits). But orders, appointments and leads are all already queryable
per company, and the ticket panel already exists as the place to put it
(`src/modules/company/components/ticket-panel.tsx`).

**Who has it.** Tidio's live visitor list is a headline feature; Intercom and
Crisp both show a rich context panel.

**Dependency.** This is much better after 1.13 (a real contact record); doing it
first is a thinner version of the same idea.

---

### 2.10 A two-way Slack inbox — **M**

**What it is.** A conversation needing a human appears in Slack, and the reply
typed in Slack reaches the customer.

**Why we are close.** Slack already exists as an outbound notification transport
(`src/lib/notification-delivery.ts:8`,
`supabase/migrations/0030_notification_delivery_settings.sql:38`), and the inbound
side is exactly the adapter contract that nine channels already implement
(`src/lib/channels/types.ts`). The engine below the adapter does not care where a
message came from.

**Who has it.** Intercom and Crisp have Slack integrations; most are
notification-only, so a genuinely two-way one is a differentiator for small teams
that live in Slack and will not open a second tool.

---

### 2.11 Agency reseller economics — **M/L**

**What it is.** An agency buys wholesale, resells at its own price, sees its
margin, and can hand a client their own login.

**Why we are close.** White-label branding is real and resolves by custom domain
on the login page (`src/lib/agency.ts:177`,
`src/app/(auth)/login/page.tsx:19`). What is missing makes the feature
unsellable rather than incomplete: sub-accounts get full paid-plan limits with
`status: 'active'` and no subscription
(`src/modules/company/agency-actions.ts:116-124`), **no user is ever created for
a sub-account** so nobody can log into it, and becoming an agency is
super-admin-only with no request form
(`src/modules/super-admin/agencies-actions.ts:70`).

**Builds on.** The credit ledger (`supabase/migrations/0024_credit_ledger…`),
`stripe_price_mappings`, the invite flow in `src/lib/invites.ts` +
`src/app/agent-invite/`, and the super-admin cost/profit views that already
compute margin per company (`src/modules/super-admin/money.ts`).

**Decide first.** `docs/OPEN_QUESTIONS.md` §5 — reseller, multi-brand, or managed
service. The three need different builds.

---

### 2.12 Voice / phone — **L**

**What it is.** The assistant answers the phone.

**Why we are closer than it looks.** `conversations.channel` has permitted
`'voice'` and `'phone'` since the first conversations migration
(`supabase/migrations/0005_conversations.sql:12`); `channel_identities` permits
them too (`0044:12`); `src/lib/api/delivery.ts:26` already treats them as in-app
channels; and `voice_transcripts_future`
(`supabase/migrations/0012_voice_privacy.sql:6`) is an explicit placeholder. The
whole answering stack — RAG, 26 tools, handoff, SLA, inbox — is channel-agnostic
by design. What is genuinely absent is STT/TTS and telephony: grepped
`whisper|elevenlabs|deepgram|tts|stt|text-to-speech|speech-to-text` — no hits.

**Who has it.** Zendesk Talk, Intercom (via partners). Tidio, Crisp, Chatbase and
ManyChat do not. For a market where a large share of small-business contact is
still a phone call, this is the largest available differentiator — and the
existing channel abstraction is most of the reason it is feasible.

**Caveat.** L means L. Telephony carries per-minute cost, latency budgets and
regulatory duties the rest of the product does not have. This is a bet, not a
sprint.

---

### 2.13 "Bring your Zendesk with you" — a migration importer — **M**

**What it is.** Point at a Zendesk, Freshdesk or Intercom account and pull the
help-centre articles, macros and contacts across.

**Why we are close.** No importer exists — `zendesk`, `freshdesk` and `intercom`
each return **zero hits** across `src/` and every migration. But the destinations
all exist and are already populated by other code paths: `documents` +
`document_sources` + the chunk/embed pipeline (`src/lib/ai/ingest.ts`),
`canned_responses` (`supabase/migrations/0040_ticketing.sql:11`), `leads`, and
the CSV importer (`src/lib/integrations/csv.ts`) as the fallback shape. All three
sources have simple, well-documented, read-only REST APIs.

**Why it matters.** Switching cost is the single biggest reason a support team
stays where it is. The most common objection to replacing an incumbent is not
price, it is "we have 400 articles in there". This is also the natural companion
to 1.12 — the same ingest work serves both.

---

### 2.14 An integrations directory, and a Shopify App Store listing — **M each**

**What it is.** A browsable catalogue the owner can shop from, and a presence in
the app stores where our customers already are.

**Why we are close.** `/company/integrations` is a management table of connected
accounts and sync jobs, not a catalogue; the connect form is a four-option
`<select>` (`src/modules/company/components/connect-integration-form.tsx:54-57`
— WooCommerce, Shopify, Custom API, Google Calendar), and only Google Calendar
has a real one-click OAuth install
(`src/app/api/integrations/google/start/route.ts:14-22`). A second, separate
token-paste page covers Shopify, Square and Foodics
(`src/app/(dashboard)/company/managed-connectors/page.tsx:32`). So the product
has more integrations than it can show, split across two screens with different
mental models.

On Shopify specifically: the API client and HMAC-verified webhooks are real
(`src/lib/integrations/sync.ts:265-434`,
`src/app/api/webhooks/store/[provider]/route.ts:381-393`) but there is **no app
listing** — no OAuth install flow, no `shopify.app.toml`. A merchant cannot
install us from the place merchants look for software.

**Who has it.** Tidio, Crisp, Intercom and Chatbase all have Shopify App Store
listings, and it is a meaningful acquisition channel for exactly this ICP.

**Note.** The single platform-wide `SHOPIFY_WEBHOOK_SECRET`
(`src/app/api/webhooks/store/[provider]/route.ts:51-54`) is a per-tenant
correctness problem today — Shopify issues a different secret per store — and a
proper app install is what fixes it, so these two items are really one.

---

## Tier 3 — Deliberately skip

| Feature | Who has it | Why we skip it |
|---|---|---|
| **Co-browsing / screen share** | Crisp | Requires a heavy DOM-mirroring runtime on the customer's site, a permanent maintenance burden across browser versions, and it is used by a tiny fraction of sessions. A screenshot upload (1.10) captures most of the value. |
| **Video calls** | Crisp, Intercom (via partners) | Same cost, less demand. WhatsApp already has a call button. |
| **Native iOS / Android agent apps, and a native mobile chat SDK** | Intercom, Zendesk, Tidio, Crisp | Already decided, and correctly. A PWA with web push ships for agents (`src/app/manifest.ts`, `public/sw.js`, `supabase/migrations/0061_web_push_and_mobile_embed.sql:30-31`), and for the customer side there is a WebView embed plus HMAC identity signing (`src/app/embed/[publicBotId]/page.tsx`, `src/lib/embed/identity.ts:20-33`). `docs/MOBILE_EMBED.md:3-8` and the migration comment at `0061:5` both state in writing that these "replace the native mobile SDK we are no longer building". Two native codebases plus app-store review cycles, forever, for a delta the PWA mostly covers. Revisit only if iOS push reliability proves unacceptable. |
| **Native HubSpot / Salesforce / Pipedrive connectors** | Intercom, Zendesk, Tidio | They appear in our own marketing copy today (`src/app/(dashboard)/company/webhooks/page.tsx:368`) with no code behind them — `hubspot` and `salesforce` each have exactly one prose hit in `src/`, `pipedrive` has none, and the `crm` provider enum value (`supabase/migrations/0008_integrations.sql:9`) has no sync branch. Each native connector is an ongoing maintenance contract with someone else's API. Ship the Zapier app (1.18) instead — it covers all three plus five thousand others for one build, and it is the answer the ICP actually needs. Reconsider only when a specific CRM shows up in enough lost deals to name it. |
| **Product tours / in-app onboarding** | Intercom | A different product category with a different buyer. It needs a JS SDK inside the customer's *application*, not their marketing site, and shares no code with the RAG or channel core. |
| **Community forum** | Zendesk Gather | Low demand below enterprise, and it is a moderation liability the customer, not us, would have to staff. |
| **Custom report builder / BI** | Zendesk Explore | Five report tabs plus CSV export (`src/app/api/company/reports/export/route.ts`) plus `GET /api/v1/analytics/summary` covers the real need. Anyone wanting more wants their own BI tool, which the API already serves. |
| **TikTok and YouTube direct messages** | ManyChat (partially) | Both DM APIs are partner-gated with no self-serve path — recorded in `docs/DELIVERY_REPORT.md` §4. Comment reply already works for both; do not promise DMs. |
| **Apple Messages for Business, Google Business Messages, RCS** | Zendesk, Intercom | Apple requires a CSP partnership; Google shut its Business Messages product down; RCS routing is carrier-dependent. High approval cost, near-zero demand in the target market. |
| **WeChat / KakaoTalk / Discord** | ManyChat, others | Wrong geography. Every hour here is an hour not spent on WhatsApp, which is the channel this market actually uses. |
| **Full Arabic dashboard translation** | Some regional competitors | The half that earns money is already done: `src/lib/ai/lang.ts:30-37` detects Arabic and Arabizi and the widget is RTL. The dashboard is 285 keys with only 5 of 49 company pages calling the dictionary. Translate the six daily-use screens (Home, Inbox, Business info, Setup, Channels, Billing); skip the yearly-settings pages. Full coverage needs 5–10× the keys and every component rethreaded, for an audience that may not exist — see `docs/OPEN_QUESTIONS.md` §6. |
| **On-prem / self-hosted deployment** | Zendesk (historically), some enterprise vendors | The `connectors/` SDK already answers the underlying objection — the customer's data stays in their system and the connector executes actions locally (`connectors/PROTOCOL.md`). Shipping a self-hostable build multiplies the support surface for the same customer. |
| **A/B testing bot prompts** | Some AI-chat vendors | Real, and genuinely absent (grepped `a/b test|ab_test|variant` — nothing). But a shop with 500 messages a month can never reach significance, and the graded eval harness (`src/lib/ai/eval.ts:64` + `src/lib/ai/judge.ts`) already answers "did this prompt get better" more cheaply and faster. |
| **Building our own payments / marketplace revenue share** | Intercom, Zendesk (app marketplaces) | A marketplace needs a developer population we do not have. The public API and the Zapier listing (1.18) get the integration coverage without the platform overhead. |

---

## Recommended next five

Ranked by value ÷ effort, then sequenced so each one makes the next easier.

| # | Item | Tier | Size | Why this one, now |
|---|---|---|---|---|
| 1 | **Self-serve signup and trial** (1.1) | T1 | S/M | Nothing else on this list can be sold until a stranger can create an account. Every other improvement compounds behind it, and every marketing pound spent today lands on a login form. |
| 2 | **Widget conversion basics** (1.19 + 1.20) — pre-chat form, out-of-hours behaviour, transcript that survives a reload, `async` script tag, minified bundle | T1 | S each | The cheapest block in the document, and it is the only surface a prospect evaluates before deciding. Right now a visitor who leaves before the model asks for details leaves nothing behind, and the transcript vanishes on refresh — both directly cost the customer the leads we are selling them. Pairs naturally with item 1: a trial account's first act is to install the widget. |
| 3 | **Inbox essentials: assign, filter, snooze** (1.2 + 1.3 + 1.4) | T1 | S each | Three small changes to one screen, sharing one `switch` statement (`inbox-data.ts:380`) and one panel (`ticket-panel.tsx`). Together they turn a demo inbox into one a three-person team can work a full day in. Highest value-per-hour of any block here. |
| 4 | **Agent AI copilot + answer citations** (1.11 + 1.5) | T1 | M | `previewAnswer` (`src/lib/ai/preview.ts:21`) is already a suggest-reply engine with the wrong name, and `rag.ts:195` already has the ranked sources — both are surfacing work, not new capability. Answers the two questions every prospect asks: "does it help my staff?" and "how do I know it isn't making things up?" |
| 5 | **No-code custom AI actions** (2.1) | T2 | M | The tool schema layer, the provider-agnostic tool loop and two separate HTTP-execution paths already exist. Converts the most common lost-deal objection — "it can't talk to our system" — from a services engagement into a form. This is the item most likely to be the reason someone chooses us over a cheaper competitor. |

**Then, immediately after:** feature entitlements per plan (1.14). Everything
above raises the product's value; that is what converts it into revenue. It is
deliberately not in the five, because gating an inbox nobody yet wants to use
only annoys people — and because it needs the pricing decision in
`docs/OPEN_QUESTIONS.md` §1 to be made first.

**Two things to fix alongside, because they are cheap and currently embarrassing:**
rename the competitor-branded SDK (2.8 — `public/sdk/revora.js` and
`REVORA_API_KEY` are rendered to every customer at
`src/app/(dashboard)/company/developers/page.tsx:48-52`), and schedule
`/api/cron` or replace it with GET routes, since integration sync, the
`background_jobs` queue and the improvement-email digest are all currently
unreachable by any scheduler (`src/app/api/cron/route.ts:16`, absent from
`vercel.json`).

**One thing to stop doing:** three shipped surfaces have no consumer —
`src/lib/groups.ts`, `src/lib/channels/whatsapp-catalog.ts` and
`src/app/(auth)/login/google-button.tsx`. Each is a feature the UI or the docs
imply exists. Either wire them (the Google button is a one-line import; groups
find their consumer in 1.13) or delete them, because a promise the product does
not keep costs more than a feature it never claimed.
