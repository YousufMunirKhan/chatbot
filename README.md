# 🤖 AI Business Assistant — Multilingual SaaS Platform

A multi-tenant SaaS platform where businesses create an **AI assistant for their
website**. Arabic + English (Gulf dialect, Arabizi, mixed messages), RTL widget,
help desk + sales, lead capture, appointments, product & order questions,
conversational order placement, a live-chat inbox with **human takeover**, and
deep **Shopify / WooCommerce / POS / CRM / custom API** integrations — with
super-admin **cost / revenue / profit** control.

> **Voice-ready architecture.** Voice is _not_ built in this phase, but the
> engine, data, tools, inbox, orders, leads, and analytics are channel-agnostic
> so future **voice, WhatsApp, and social DM** channels reuse the same core.

> **Status: all 25 modules implemented ✅** — runs end-to-end in *mock mode* with
> no external keys (Supabase only). Add an `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`
> for real AI + autonomous tool use; provider creds for live store sync; Stripe
> for self-service billing. 13 DB migrations, verified with `npm run test:all`
> (+ `test:chat`, `test:inbox` against a running dev server).

---

## 📚 Documentation map

| Doc | What's inside |
| --- | --- |
| **[docs/modules/](docs/modules/)** | One README per module (all 25) — goal, build steps, tables, tools, acceptance criteria |
| [docs/modules/README.md](docs/modules/README.md) | Build order, milestones, dependency graph |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level architecture, channel adapters, data flow |
| [docs/DATABASE.md](docs/DATABASE.md) | Full schema overview & migration plan |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Accounts to create, env vars, Vercel + Supabase deploy |
| [src/modules/README.md](src/modules/README.md) | How code folders map to modules |

**Build the project module by module — never all at once.** Start with
[Module 1](docs/modules/module-01-project-foundation.md).

---

## 🧱 Tech stack

| Layer | Technology |
| --- | --- |
| Frontend / Dashboard | Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Zod, React Hook Form |
| Backend | Next.js route handlers, Server-Sent Events (AI streaming), Supabase Realtime, Trigger.dev (jobs), webhooks |
| Database | Supabase Postgres + `pgvector` + full-text search + Row Level Security |
| AI | **Switchable** provider layer — OpenAI / Anthropic / Voyage / Cohere (chat, embeddings, reranker) |
| Billing | Stripe (Checkout, subscriptions, webhooks, Tax) |
| Hosting | Vercel (app), Supabase (DB/Realtime/Storage), Trigger.dev (jobs), Cloudflare (widget CDN) |

---

## 🚀 Quick start

> Prerequisites: **Node.js ≥ 18.18**, npm, and accounts listed in
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Supabase at minimum to run locally).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local        # then fill in your keys
#   (Windows PowerShell:  Copy-Item .env.example .env.local)

# 3. Run database migrations (needs DATABASE_URL in .env.local)
npm run db:migrate                # applies supabase/migrations/* in order

# 4. Create your first super-admin login
npm run seed:admin -- you@example.com "a-strong-password"

# 5. Run the dev server
npm run dev                       # http://localhost:3000  → sign in at /login
```

Verify the foundation is live:

- Landing page → http://localhost:3000
- Dashboard shell → http://localhost:3000/dashboard
- Health check → http://localhost:3000/api/health

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (no emit) |
| `npm run format` | Prettier write |
| `npm run db:check` | Verify Supabase credentials |
| `npm run db:migrate` | Apply database migrations |
| `npm run seed:admin -- <email> <pw>` | Create/reset a platform super admin |
| `npm run test:all` | Auth, onboarding, company, prompt & business-data checks |
| `npm run test:chat` / `test:inbox` | Chat/RAG + human-takeover checks (needs `npm run dev` running) |

> **Background jobs:** trigger hourly sync + 30-day chat retention with
> `POST /api/cron` (body `{"task":"sync"}` or `{"task":"cleanup"}`,
> `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`) from Trigger.dev or Vercel Cron.

---

## 📁 Project structure

```
src/
  app/
    (auth)/            # login & auth routes (Module 3)
    (dashboard)/       # super-admin + company + agent shell (Modules 4,5)
    api/               # route handlers (health, chat, webhooks, ...)
  components/ui/       # shadcn/ui primitives
  lib/
    ai/                # AI provider abstraction (Module 9)
    db/                # Supabase clients (browser / server / service-role)
    auth/              # session & role guards (Module 3)
    billing/           # Stripe + plan enforcement (Module 19)
    integrations/      # connector interface (Module 14)
    realtime/          # Supabase Realtime helpers (Module 11)
    settings/          # platform/company/bot settings resolver (Module 2)
    tools/             # channel-agnostic AI tool layer (Modules 16–18)
    env.ts logger.ts errors.ts crypto.ts constants.ts utils.ts
  modules/             # feature slices (see src/modules/README.md)
  types/  schemas/     # shared types & Zod schemas
supabase/migrations/   # SQL migrations, one set per module
public/widget/         # built embeddable widget (Module 8)
docs/                  # this documentation
```

---

## 🔑 Non-negotiable rules (enforced across modules)

1. Build module by module — not everything in one shot.
2. Every module ships clear DB migrations.
3. Every configurable value comes from **platform / company / bot settings**.
4. The AI provider is **switchable** — never hardcode one provider.
5. The widget contains **no business logic** — it only sends/receives messages.
6. All sensitive keys stay backend-only; integration tokens are **encrypted**.
7. Order **placement** requires backend validation; order **details** require
   customer verification (order # + phone/email).
8. A human agent reply **pauses AI** for that conversation.
9. All data is **company-isolated** (RLS + `company_id` scoping).
10. Structured business data (products/orders/stock/customers) lives in
    **structured tables** — RAG/vector chunks are only for docs/policies/FAQs.
11. Arabic/English support is **tested**, not just translated.

See the full list in [docs/modules/README.md](docs/modules/README.md#developer-rules).

---

## 🗺️ Module index

| # | Module | # | Module |
| --- | --- | --- | --- |
| 1 | [Project Foundation](docs/modules/module-01-project-foundation.md) | 14 | [Integrations & Hourly Sync](docs/modules/module-14-integrations-hourly-sync.md) |
| 2 | [Database & Multi-Tenant Schema](docs/modules/module-02-database-multitenant-settings.md) | 15 | [Structured Product/Order Data](docs/modules/module-15-structured-business-data.md) |
| 3 | [Auth & Role-Based Access](docs/modules/module-03-auth-rbac.md) | 16 | [Product & Stock Assistant](docs/modules/module-16-product-stock-assistant.md) |
| 4 | [Super Admin Dashboard](docs/modules/module-04-super-admin-dashboard.md) | 17 | [Order Details / Tracking](docs/modules/module-17-order-details-tracking.md) |
| 5 | [Company Admin Dashboard](docs/modules/module-05-company-admin-dashboard.md) | 18 | [Conversational Order Placement](docs/modules/module-18-conversational-order-placement.md) |
| 6 | [Bot/Assistant Configuration](docs/modules/module-06-bot-assistant-configuration.md) | 19 | [Billing, Plans & Limits](docs/modules/module-19-billing-plans-limits.md) |
| 7 | [Conversation Engine](docs/modules/module-07-conversation-engine.md) | 20 | [Usage / Cost / Revenue / Profit](docs/modules/module-20-usage-cost-revenue-profit.md) |
| 8 | [Website Widget](docs/modules/module-08-website-widget.md) | 21 | [Arabic + English + RTL](docs/modules/module-21-arabic-english-rtl.md) |
| 9 | [AI Assistant Engine](docs/modules/module-09-ai-assistant-engine.md) | 22 | [Voice-Ready Design](docs/modules/module-22-voice-ready-design.md) |
| 10 | [Knowledge Base / RAG](docs/modules/module-10-knowledge-base-rag.md) | 23 | [Privacy, Security, Retention](docs/modules/module-23-privacy-security-retention.md) |
| 11 | [Business Inbox & Takeover](docs/modules/module-11-business-inbox-live-takeover.md) | 24 | [Notifications](docs/modules/module-24-notifications.md) |
| 12 | [Leads Module](docs/modules/module-12-leads-module.md) | 25 | [Testing & Evaluation Harness](docs/modules/module-25-testing-evaluation-harness.md) |
| 13 | [Appointment Module](docs/modules/module-13-appointment-module.md) | | |

---

## License

Proprietary — internal build plan implementation. Update before any public release.
