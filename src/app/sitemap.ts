import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/**
 * `/sitemap.xml` — which, until this file existed, returned 404.
 *
 * WHY IT IS HAND-WRITTEN AND NOT CRAWLED FROM THE ROUTE TREE
 * ----------------------------------------------------------
 * Next gives no supported way to enumerate the app's own routes at build time,
 * and the alternatives — globbing `src/app` at runtime, or a build step that
 * writes a manifest — both put a file the crawler depends on at the mercy of a
 * refactor nobody would think to check. A list that must be edited by hand is
 * honest about the fact that adding a public page is a decision, not an
 * accident. **Add every new public page here when you create it.**
 *
 * WHAT IS NOT IN THIS FILE
 * ------------------------
 * The per-tenant help centres publish their own sitemaps at
 * `/help/[handle]/sitemap.xml`, built from that tenant's published articles.
 * They are deliberately not merged in here: there are many tenants, the set
 * changes without a deploy, and a stale copy in this file would be worse than
 * no copy. They are reachable because `robots.ts` leaves `/help/` crawlable and
 * the marketing footer links to the help centre.
 *
 * `/login` and `/signup` are omitted on purpose. They are crawlable but carry
 * `noindex`, so listing them here would only ask a crawler to fetch a page in
 * order to be told to ignore it.
 *
 * ON `lastModified`
 * -----------------
 * Deliberately absent. A truthful value would need per-page content dates the
 * repository does not track, and the usual bodge — stamping "now" on every
 * build — tells a crawler that all seven pages changed every time anything
 * deployed, which is a claim it learns to distrust. Omitting the field is more
 * useful than filling it with a lie.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

  // `priority` is relative within this file only — it says nothing to a crawler
  // about how this site compares to any other. The ordering below is simply:
  // the page a buyer should land on, the page that closes the sale, the page
  // that answers "how hard is this", then the legal pages, which exist for
  // trust and for people searching the specific obligations they cover.
  const pages: Array<{ path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }> = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/customer-onboarding', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/ai-disclosure', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/data-processing', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  ];

  return pages.map(({ path, priority, changeFrequency }) => ({
    url: `${base}${path}`,
    priority,
    changeFrequency,
  }));
}
