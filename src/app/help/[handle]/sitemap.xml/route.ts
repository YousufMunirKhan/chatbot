import { getHelpCenterSitemap } from '@/modules/help-center/data';

/**
 * `sitemap.xml` for one company's help centre.
 *
 * A route handler rather than Next's `sitemap.ts` convention: that file needs
 * `generateSitemaps` to produce anything under a dynamic segment, which means
 * enumerating every tenant at build time. There are thousands of them and the
 * list changes hourly, so the sitemap is generated per request instead.
 *
 * A company that has switched its help centre off, or a handle that resolves to
 * nothing, gets a 404 — the same answer the pages themselves give, so a crawler
 * is never handed a list of URLs it will then be refused.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(
  _request: Request,
  { params }: { params: { handle: string } },
): Promise<Response> {
  const entries = await getHelpCenterSitemap(params.handle);
  if (!entries) return new Response('Not found', { status: 404 });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => {
      const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
      return `<url><loc>${escapeXml(entry.loc)}</loc>${lastmod}</url>`;
    }),
    '</urlset>',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Crawlers re-fetch this often and the content changes when somebody
      // publishes, which is rare. Ten minutes keeps it fresh enough without
      // paying for the query on every hit.
      'cache-control': 'public, max-age=600',
    },
  });
}
