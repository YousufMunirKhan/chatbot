# `src/modules` — Feature modules

Each folder is a self-contained feature slice (UI + server actions + services +
schemas for one area of the product). Keep cross-cutting primitives in
`src/lib` and shared types in `src/types` / `src/schemas`.

| Folder | Build doc | What lives here |
| --- | --- | --- |
| `super-admin/` | [Module 4](../../docs/modules/module-04-super-admin-dashboard.md) | Platform owner: onboard companies, plans, usage/cost/revenue/profit |
| `company/` | [Module 5](../../docs/modules/module-05-company-admin-dashboard.md) | Company admin: profile, team, settings pages |
| `bots/` | [Module 6](../../docs/modules/module-06-bot-assistant-configuration.md) | Assistant config, capabilities, prompt templates |
| `inbox/` | [Module 11](../../docs/modules/module-11-business-inbox-live-takeover.md) | Live chat inbox + human takeover |
| `knowledge/` | [Module 10](../../docs/modules/module-10-knowledge-base-rag.md) | RAG training, ingestion, retrieval |
| `integrations/` | [Module 14](../../docs/modules/module-14-integrations-hourly-sync.md) | Shopify / WooCommerce / CSV / Custom API / POS sync |
| `orders/` | [Modules 17–18](../../docs/modules/module-18-conversational-order-placement.md) | Order tracking + conversational order placement / cart |
| `appointments/` | [Module 13](../../docs/modules/module-13-appointment-module.md) | Appointment requests & booking |
| `analytics/` | [Module 20](../../docs/modules/module-20-usage-cost-revenue-profit.md) | Usage, AI cost, revenue, profit dashboards |
| `widget/` | [Module 8](../../docs/modules/module-08-website-widget.md) | Embeddable Vanilla-JS website widget |

> Leads (Module 12), Products/Stock (Module 16), Channel engine (Module 7), and
> the AI engine (Module 9) are implemented under `src/lib` + co-located code and
> surfaced through these module folders.
