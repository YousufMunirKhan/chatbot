import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/**
 * `/robots.txt` — which, until this file existed, returned 404.
 *
 * WHY THE `Sitemap:` LINE IS THE POINT
 * ------------------------------------
 * The disallow rules below matter, but they are not why this file is urgent.
 * This site has no inbound links, so a crawler has no way to discover any URL
 * on it except by being told. The `Sitemap:` line is that telling — it is the
 * only discovery mechanism currently available, and it did not exist.
 *
 * WHAT IS BLOCKED, AND WHY EACH ONE
 * ---------------------------------
 * `/c/` is the tenant agent workspace. It is public, it is indexable, and it
 * prints each company's own name in an `<h1>` — so left alone it would publish
 * the customer list as thousands of near-duplicate thin pages. That is the one
 * entry here that is a privacy matter and not merely an SEO one.
 *
 * `/embed/` already sets `noindex` in its own metadata; it is repeated here
 * because a crawler that never fetches the page never reads that tag, and this
 * saves the crawl budget of finding out.
 *
 * The dashboard, admin and auth paths are blocked because they are useless in a
 * search result: `middleware.ts` bounces an anonymous visitor from `/company`,
 * `/super-admin` and `/dashboard` to `/login`, so an indexed URL would be a
 * result that cannot be opened. `/agent-invite/` carries a single-use token in
 * the path and must never be crawled at all.
 *
 * `/api/` is disallowed rather than left to chance — several routes are
 * deliberately public (webhooks, the widget's own endpoints) and none of them
 * has anything to say to a search engine.
 *
 * WHAT IS DELIBERATELY NOT BLOCKED
 * --------------------------------
 * `/help/` — the per-tenant help centres. Those are the product's cheapest
 * source of long-tail traffic once articles exist, and they publish their own
 * per-tenant sitemaps. Blocking them here would switch that off before it was
 * ever switched on.
 *
 * They are, however, still orphaned: nothing on the marketing site links to a
 * help centre, so leaving them crawlable is necessary but not sufficient. There
 * is no platform-level `/help` index to link at — the route is `/help/[handle]`
 * and every handle belongs to one tenant, the only Switch & Save-shaped one
 * being a demo that `scripts/seed-switch-and-save.mjs` wipes and rebuilds on
 * every run. A footer link needs a real help centre to point at first.
 *
 * `/login` and `/signup` stay crawlable but carry `noindex` on the pages
 * themselves: a brand search for the product should still be able to resolve to
 * the sign-in page, and `noindex` keeps them out of results without hiding them
 * from a crawler following an internal link.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/c/',
          '/embed/',
          '/company/',
          '/super-admin/',
          '/dashboard/',
          '/agent-invite/',
          '/api/',
          '/forgot-password',
          '/reset-password',
          '/two-factor',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
