# Deployment Guide

This covers the accounts to create, environment variables, and how to deploy to
Vercel + Supabase + Trigger.dev + Cloudflare.

## 1. Accounts to create

Create these before development (only **Supabase** is strictly required to run
Module 1 locally).

| Account | Purpose |
| --- | --- |
| **Supabase** | Postgres, `pgvector`, Realtime, Storage, (optional) Auth & Edge Functions |
| **Vercel** | Deploy the Next.js dashboard/backend, env vars, preview deployments |
| **Stripe** | Subscriptions, checkout sessions, billing, tax, webhooks |
| **AI provider** (≥1) | OpenAI, Anthropic, Voyage AI, and/or Cohere |
| **Trigger.dev** | Hourly sync jobs, ingestion jobs, retryable background tasks, cleanup |
| **Cloudflare** | CDN for the widget script, DNS, caching, optional bot protection |
| **Shopify Partner** | Shopify app/integration: OAuth, GraphQL Admin API, webhooks |
| **WooCommerce test store** | REST API + webhook testing, products/orders sync |
| **Email provider** (≥1) | Resend / SendGrid / Amazon SES — lead, appointment, handoff, order, system emails |

## 2. Environment variables

Copy `.env.example` → `.env.local` and fill in values. Full list with comments
lives in [`.env.example`](../.env.example). Groups:

- **App** — `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WIDGET_URL`, `APP_ENV`
- **Supabase** — URL, anon key, service-role key, `DATABASE_URL`
- **AI providers** — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `COHERE_API_KEY`
- **Default AI settings** — chat/advanced/embedding/rerank provider + model
- **Stripe** — secret key, webhook secret, publishable key
- **Trigger.dev** — secret key, project id
- **Email** — `RESEND_API_KEY`, `EMAIL_FROM`
- **Shopify / WooCommerce** — client id/secret, webhook secrets, scopes
- **Security** — `ENCRYPTION_KEY` (32 bytes), `JWT_SECRET`, `ADMIN_SUPPORT_ACCESS_REQUIRED`
- **Redis (optional)** — `REDIS_URL`

> Generate `ENCRYPTION_KEY` (32 bytes hex):
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. Database setup

```bash
# Option A — Supabase CLI
supabase link --project-ref <your-ref>
supabase db push                    # applies supabase/migrations/*.sql in order

# Option B — Dashboard
# Paste each migration SQL into Supabase → SQL Editor, in numeric order.
```

The first migration enables `pgvector`, `pg_trgm`, and `pgcrypto`. See
[supabase/migrations/README.md](../supabase/migrations/README.md).

## 4. Local development

```bash
npm install
cp .env.example .env.local          # PowerShell: Copy-Item .env.example .env.local
npm run dev                         # http://localhost:3000
```

Smoke test: `/`, `/dashboard`, and `GET /api/health` (returns `{ "status": "ok" }`).

## 5. Deploy to Vercel

1. Push the repo to GitHub/GitLab and **Import Project** in Vercel.
2. Framework preset: **Next.js** (auto-detected). Build: `next build`.
3. Add every variable from `.env.example` under **Settings → Environment
   Variables** (Production + Preview). Do **not** commit real secrets.
4. Deploy. Preview deployments are created per pull request.
5. Set `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_WIDGET_URL` to the production domain.

## 6. Stripe webhooks

- Add an endpoint: `https://<your-domain>/api/webhooks/stripe` (built in Module 19).
- Subscribe to `checkout.session.completed`, `customer.subscription.*`,
  `invoice.payment_failed`.
- Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
- Local testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

## 7. Background jobs (Trigger.dev)

- Create a project, set `TRIGGER_SECRET_KEY` + `TRIGGER_PROJECT_ID`.
- Jobs: hourly integration sync, knowledge ingestion, 30-day chat cleanup,
  retryable webhooks (Modules 10, 14, 23).

## 8. Widget CDN (Cloudflare)

- The built widget is served from `/widget/widget.js` (CORS + cache headers set
  in `next.config.mjs`).
- Front it with Cloudflare and point `cdn.yourdomain.com` at the app; customers
  embed `https://cdn.yourdomain.com/widget.js`.

## 9. Production checklist

- [ ] All env vars set in Vercel (Production + Preview)
- [ ] Migrations applied; RLS enabled on tenant tables
- [ ] At least one AI provider key present
- [ ] Stripe webhook verified
- [ ] Trigger.dev jobs deployed & scheduled
- [ ] `ENCRYPTION_KEY` set (integration tokens encrypted)
- [ ] Widget reachable via CDN; domain allow-list enforced
- [ ] `/api/health` returns ok on the production domain
