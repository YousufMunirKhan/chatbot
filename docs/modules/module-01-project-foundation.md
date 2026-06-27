# Module 1 — Project Foundation

> **Milestone:** M1 · **Depends on:** none (the starting point) · **Status:** ✅ Implemented

## 🎯 Goal
Establish the base Next.js project: code structure, linting, environment-variable validation, shared helpers, and deployment setup. This is the foundation every other module builds on, and it is **already implemented in this repo**.

## 📦 What to build
- Next.js project (App Router) with TypeScript
- Tailwind CSS
- shadcn/ui component library
- ESLint + Prettier
- Environment variable validation (Zod)
- Basic root layout
- Dashboard shell (`(dashboard)` route group)
- `/api` folder structure
- Shared `/types` folder
- Shared `/schemas` validation folder
- Error-handling helpers
- Logging helper

## 🗄️ Database / Tables
None — schema arrives in [Module 2](module-02-database-multitenant-settings.md).

## 🧭 Pages / Routes
| Route group | Purpose |
| --- | --- |
| `src/app/(auth)/` | Auth pages (fleshed out in [Module 3](module-03-auth-rbac.md)) |
| `src/app/(dashboard)/` | Authenticated dashboard shell |
| `src/app/api/` | API route handlers |
| `src/app/api/health/route.ts` | Health-check endpoint |

## 📁 Folder Structure
```
/src
  /app
    /(auth)
    /(dashboard)
    /api
  /components
  /lib
    /ai /db /auth /billing /integrations /realtime /settings /tools
  /modules
    /super-admin /company /bots /inbox /knowledge /integrations /orders /appointments /analytics /widget
  /types
  /schemas
```

## 📐 Rules & Constraints
- Architecture must stay **multi-tenant-ready** for all future modules.
- All configurable behavior is read from settings, not hardcoded (see [Module 2](module-02-database-multitenant-settings.md)).
- Environment variables are validated at startup; missing/invalid vars fail fast.
- Do **not** implement business features in this module.
- AI provider must remain switchable via the `src/lib/ai/` abstraction (OpenAI/Anthropic/Voyage/Cohere).

## ✅ Acceptance Criteria
- [ ] Project runs locally
- [ ] `.env.example` exists with all required variables
- [ ] Basic dashboard page loads
- [ ] Deployment to Vercel works

## 📌 Implemented Files
These real files in the repo satisfy Module 1:

| File | Responsibility |
| --- | --- |
| `src/lib/env.ts` | Env validation via Zod |
| `src/lib/logger.ts` | Logging helper |
| `src/lib/errors.ts` | Error-handling helpers |
| `src/lib/utils.ts` | Shared utilities |
| `src/lib/constants.ts` | Shared constants (incl. role names) |
| `src/app/layout.tsx` | Root layout |
| `src/app/(dashboard)/layout.tsx` | Dashboard shell |
| `src/app/api/health/route.ts` | Health-check endpoint |
| `.env.example` | Template for all required env vars |
| `package.json` | Dependencies and scripts |
| `tailwind.config.ts` | Tailwind configuration |

## First Build Prompt
The project's canonical "First Claude Code / Codex Prompt":

> You are building a multi-tenant SaaS called AI Business Assistant Platform. Do not build the whole project in one attempt. Start with Module 1 only. Tech stack: Next.js, TypeScript, Tailwind, shadcn/ui, Supabase Postgres, pgvector, Supabase Realtime, Stripe, Trigger.dev, AI provider abstraction. Build Module 1: Project Foundation. Requirements: 1. Create clean Next.js project structure. 2. Add TypeScript, Tailwind, shadcn/ui. 3. Create /src structure with app, components, lib, modules, types, schemas. 4. Create environment variable validation. 5. Create dashboard shell routes. 6. Create shared error/logging helpers. 7. Add README with setup steps. 8. Add .env.example with all required variables. 9. Do not implement business features yet. 10. Keep architecture ready for multi-tenant SaaS and future modules. After completing Module 1, stop and provide summary, changed files, and next recommended module.

## 🔗 Related
- [Module 2 — Database, Multi-Tenant Schema & Settings](module-02-database-multitenant-settings.md)
- [Module 3 — Authentication & RBAC](module-03-auth-rbac.md)
- Repo paths: `src/lib/env.ts`, `src/lib/logger.ts`, `src/lib/errors.ts`, `src/app/layout.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/api/health/route.ts`, `.env.example`, `tailwind.config.ts`
