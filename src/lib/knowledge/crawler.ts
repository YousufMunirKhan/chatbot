import {
  CRAWL_FETCH_TIMEOUT_MS,
  MAX_CRAWL_DEPTH,
  MAX_CRAWL_PAGE_CHARS,
  MAX_SITEMAP_CHILDREN,
  MAX_SITEMAP_URLS_SCANNED,
  MIN_READABLE_PAGE_CHARS,
  truncateWithNotice,
  type TruncationOutcome,
} from './limits';

/**
 * Website crawling for the knowledge base.
 *
 * Three things were wrong with the crawler this replaces, and only one of them
 * was the page count.
 *
 * 1. It never looked for a sitemap. It read the home page, scraped its hrefs,
 *    and stopped — one hop. A shop's product and policy pages usually sit two
 *    or three clicks in, and most shop platforms publish a sitemap listing all
 *    of them. Asking for `/sitemap.xml` first is both cheaper and better.
 *
 * 2. It merged every page into ONE document. That retrieves badly in a way that
 *    is easy to miss: the merged blob is chunked on character offsets that have
 *    nothing to do with page boundaries, so a chunk straddles the end of the
 *    shipping page and the start of the careers page, every question matches
 *    the same few chunks of the same giant document, and the citation the
 *    assistant shows is "Website import: example.com" rather than the page that
 *    actually answers. Pages are separate documents now, each with its own URL.
 *
 * 3. It took 8 pages and merged them under a 50,000-character cap, so the
 *    trailing pages of a crawl frequently contributed nothing at all — and
 *    nothing said so.
 *
 * Nothing in this module touches the database or `next/*`; it is fetch and
 * parse only. Persisting pages is the caller's job (see `ingest-queue.ts`),
 * which keeps this testable and keeps request context out of the crawl loop.
 */

// --- URL helpers ------------------------------------------------------------

export function normalizeWebsiteUrl(value: string): URL {
  return new URL(value.includes('://') ? value : `https://${value}`);
}

/** Host without `www.` and case, so `WWW.X.com` and `x.com` count as the same site. */
export function comparableHost(value: string): string {
  try {
    return normalizeWebsiteUrl(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        ?.replace(/^www\./, '') ?? ''
    );
  }
}

/** Origin + path (no query/hash/trailing slash) so an explicit `/en` survives. */
export function websiteValue(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/**
 * The stored key for a crawled page. It has to be stable across recrawls or the
 * unique index on `(company_id, source_url)` cannot do its job: `/about`,
 * `/about/`, `/about?utm_source=x` and `/about#team` are one page and must
 * produce one document. Query strings that are not tracking noise are kept,
 * because plenty of small sites still route with `?page_id=`.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|_ga$)/i;

export function canonicalPageUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.hash = '';
  for (const key of [...clean.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) clean.searchParams.delete(key);
  }
  clean.searchParams.sort();
  if (clean.pathname !== '/' && clean.pathname.endsWith('/')) {
    clean.pathname = clean.pathname.replace(/\/+$/, '');
  }
  return clean.toString();
}

const NON_PAGE_EXTENSION = /\.(pdf|jpg|jpeg|png|gif|webp|svg|ico|zip|rar|mp3|mp4|mov|avi|docx?|xlsx?|pptx?|css|js|json|xml|rss)$/i;

function isSameSite(candidate: URL, root: URL): boolean {
  return comparableHost(candidate.hostname) === comparableHost(root.hostname);
}

function isCrawlablePage(candidate: URL, root: URL): boolean {
  if (!/^https?:$/.test(candidate.protocol)) return false;
  if (!isSameSite(candidate, root)) return false;
  if (NON_PAGE_EXTENSION.test(candidate.pathname)) return false;
  // Cart, checkout, login and search-result URLs are per-visitor, never useful
  // knowledge, and on a shop platform there are hundreds of them.
  if (/\/(cart|checkout|login|signin|sign-in|register|account|my-account|wp-admin|wp-login|feed)(\/|$)/i.test(candidate.pathname)) {
    return false;
  }
  return true;
}

/**
 * How likely a path is to hold something a customer asks about. Used to order
 * the crawl, so that when a site has more pages than the ceiling, the pages we
 * keep are the ones worth keeping.
 */
export function scoreWebsitePath(url: URL): number {
  const path = `${url.pathname} ${url.search}`.toLowerCase();
  const keywords = [
    'about',
    'service',
    'services',
    'product',
    'products',
    'shop',
    'store',
    'catalog',
    'catalogue',
    'menu',
    'pricing',
    'price',
    'faq',
    'help',
    'contact',
    'support',
    'shipping',
    'delivery',
    'refund',
    'return',
    'warranty',
    'policy',
    'terms',
    'hours',
    'booking',
  ];
  return keywords.reduce((score, keyword) => score + (path.includes(keyword) ? 1 : 0), 0);
}

/**
 * Path segments below the site root: `/about` is 1, `/shop/tents/x` is 3.
 *
 * Used as the depth bound for LINK discovery only. Following hrefs with no
 * bound walks into `/blog/2019/03/some-post` and fills the crawl with archive
 * pages nobody asks a support question about; the old crawler solved that by
 * stopping after one hop, which also missed every product page. A sitemap URL
 * is never depth-filtered — the site listed that page deliberately, and shop
 * platforms legitimately publish `/collections/x/products/y`.
 */
export function pathDepth(url: URL): number {
  return url.pathname.split('/').filter(Boolean).length;
}

/** Shortest, highest-scoring paths first — home and top-level pages before the
 *  fifth page of a blog archive. */
export function rankCrawlUrls(urls: string[]): string[] {
  return [...new Set(urls)]
    .map((href) => {
      try {
        return new URL(href);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => u !== null)
    .sort(
      (a, b) =>
        scoreWebsitePath(b) - scoreWebsitePath(a) ||
        a.pathname.split('/').length - b.pathname.split('/').length ||
        a.pathname.length - b.pathname.length,
    )
    .map((u) => canonicalPageUrl(u));
}

// --- HTML → text ------------------------------------------------------------

export function extractPageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleFromHtml(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = extractPageText(match?.[1] ?? '').slice(0, 120);
  return title || fallback;
}

export function extractSameDomainLinks(html: string, baseUrl: URL, root: URL): string[] {
  const links = new Set<string>();
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html))) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
    try {
      const next = new URL(raw, baseUrl);
      if (!isCrawlablePage(next, root)) continue;
      links.add(canonicalPageUrl(next));
    } catch {
      continue;
    }
  }
  return [...links];
}

// --- Fetching ---------------------------------------------------------------

const USER_AGENT = 'AI Business Assistant knowledge importer';

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  html: string;
  truncation: TruncationOutcome;
}

/**
 * Fetch one page and reduce it to readable text. Returns null — rather than
 * throwing — for the ordinary failures (non-HTML, an error status, a page with
 * no prose), because a crawl must survive them and carry on.
 */
export async function fetchReadablePage(url: string): Promise<CrawledPage | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(CRAWL_FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    return null;
  }
  const html = await res.text();
  const text = extractPageText(html);
  if (text.length < MIN_READABLE_PAGE_CHARS) return null;

  const capped = truncateWithNotice(text, MAX_CRAWL_PAGE_CHARS, 'This page');
  return {
    // The URL AFTER redirects, so a crawl and a recrawl agree on the key even
    // when the site moved `/about` to `/about-us`.
    url: canonicalPageUrl(new URL(res.url || url)),
    title: titleFromHtml(html, url),
    text: capped.text,
    html,
    truncation: capped.outcome,
  };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(CRAWL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// --- Sitemap discovery ------------------------------------------------------

function locsFrom(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < MAX_SITEMAP_URLS_SCANNED) {
    const value = (m[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .trim();
    if (value) out.push(value);
  }
  return out;
}

/** Sitemap URLs a site advertises in robots.txt, plus the conventional paths. */
async function candidateSitemapUrls(root: URL): Promise<string[]> {
  const candidates: string[] = [];
  const robots = await fetchText(new URL('/robots.txt', root.origin).toString());
  if (robots) {
    for (const line of robots.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap\s*:\s*(\S+)\s*$/i);
      if (m?.[1]) candidates.push(m[1]);
    }
  }
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml']) {
    candidates.push(new URL(path, root.origin).toString());
  }
  return [...new Set(candidates)];
}

/**
 * Every page URL the site's sitemap advertises, following one level of sitemap
 * index. Returns an empty array when the site publishes no usable sitemap,
 * which is the signal to fall back to following links.
 */
export async function discoverSitemapUrls(root: URL): Promise<string[]> {
  const found = new Set<string>();

  for (const sitemapUrl of await candidateSitemapUrls(root)) {
    if (found.size >= MAX_SITEMAP_URLS_SCANNED) break;
    const xml = await fetchText(sitemapUrl);
    if (!xml || !xml.includes('<loc')) continue;

    const locs = locsFrom(xml);
    const isIndex = /<sitemapindex/i.test(xml);

    if (isIndex) {
      for (const child of locs.slice(0, MAX_SITEMAP_CHILDREN)) {
        if (found.size >= MAX_SITEMAP_URLS_SCANNED) break;
        const childXml = await fetchText(child);
        if (!childXml) continue;
        for (const loc of locsFrom(childXml)) addIfCrawlable(loc, root, found);
      }
    } else {
      for (const loc of locs) addIfCrawlable(loc, root, found);
    }

    // One sitemap that produced pages is enough; the conventional paths below it
    // in the candidate list are almost always the same file under another name.
    if (found.size > 0) break;
  }

  return [...found];
}

function addIfCrawlable(raw: string, root: URL, into: Set<string>): void {
  if (into.size >= MAX_SITEMAP_URLS_SCANNED) return;
  try {
    const url = new URL(raw);
    if (isCrawlablePage(url, root)) into.add(canonicalPageUrl(url));
  } catch {
    /* a malformed <loc> is not worth failing the crawl over */
  }
}

// --- Planning ---------------------------------------------------------------

export type CrawlDiscovery = 'sitemap' | 'links';

export interface CrawlPlan {
  discovery: CrawlDiscovery;
  /** Ranked, capped list to fetch. For `links` this is only the seed — the rest
   *  is discovered as pages come back. */
  queue: string[];
  /** How many pages the site advertised before the cap was applied. Lets the UI
   *  say "your site has 214 pages, we indexed the 60 most useful". */
  discovered: number;
}

/**
 * Decide how to crawl a site: sitemap when it has one, links when it does not.
 *
 * The sitemap path is preferred because it is one request instead of dozens,
 * it reaches pages no navigation links to, and it gives an honest total to
 * report. `limit` is applied AFTER ranking, so a site with more pages than the
 * ceiling still gets its policy and product pages read first.
 */
export async function planCrawl(startUrl: URL, limit: number): Promise<CrawlPlan> {
  const seed = canonicalPageUrl(startUrl);
  const sitemapUrls = await discoverSitemapUrls(startUrl);

  if (sitemapUrls.length > 0) {
    const ranked = rankCrawlUrls([seed, ...sitemapUrls]);
    return { discovery: 'sitemap', queue: ranked.slice(0, limit), discovered: ranked.length };
  }
  return { discovery: 'links', queue: [seed], discovered: 1 };
}

// --- Running ----------------------------------------------------------------

export interface CrawlStepResult {
  /** Pages fetched and handed to `onPage` in this run. */
  ingested: number;
  /** Pages that could not be read. */
  failed: number;
  /** Still to do — persist this and resume, or empty when the crawl finished. */
  remaining: string[];
  /** Pages the site had that the ceiling excluded. */
  skipped: number;
}

export interface CrawlStepOptions {
  root: URL;
  discovery: CrawlDiscovery;
  /** URLs still to fetch, in priority order. */
  queue: string[];
  /** URLs already turned into documents by an earlier run of the same crawl. */
  seen: string[];
  /** Hard ceiling on pages for the whole crawl, across every run. */
  pageLimit: number;
  /**
   * How many URLs may be held in the frontier. Separate from `pageLimit`
   * because the first pass runs inside a request and fetches only a handful of
   * pages, but still has to hand the background job a full queue: tying
   * discovery to `pageLimit` would mean a link-crawled site (no sitemap) queued
   * three URLs and the background crawl had nothing to do. Defaults to
   * `pageLimit`, which is right for a run that is not splitting the work.
   */
  frontierLimit?: number;
  /** How many pages this crawl has already ingested in earlier runs. */
  alreadyIngested: number;
  /** Stop and return `remaining` once this epoch-ms deadline passes. */
  deadline: number;
  /**
   * Store one page. Returning `false` means the page was NOT stored and the
   * crawl should stop — the caller's own budget ran out. Without that channel a
   * page the caller declined would still be counted as ingested, and a crawl
   * that hit the knowledge-base size limit would report pages it never saved.
   */
  onPage: (page: CrawledPage) => Promise<boolean | void>;
}

/**
 * Fetch pages until the queue empties, the page limit is reached, or the
 * deadline passes — whichever comes first — handing each readable page to
 * `onPage`.
 *
 * Returning `remaining` rather than looping to completion is what makes a
 * 60-page crawl safe to run on the `background_jobs` queue: a run that does not
 * finish inside its budget hands the rest back and the job re-queues itself,
 * so no single cron drain is monopolised by one large site.
 */
export async function crawlStep(options: CrawlStepOptions): Promise<CrawlStepResult> {
  const seen = new Set(options.seen);
  const queue = options.queue.filter((url) => !seen.has(url));
  let ingested = 0;
  let failed = 0;
  let discoveredExtra = 0;

  while (queue.length > 0) {
    if (options.alreadyIngested + ingested >= options.pageLimit) break;
    if (Date.now() >= options.deadline) break;

    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);

    let page: CrawledPage | null = null;
    try {
      page = await fetchReadablePage(url);
    } catch {
      // A single blocked, slow or malformed page must not end the crawl.
      page = null;
    }
    if (!page) {
      failed++;
      continue;
    }

    // A redirect can land on a URL another entry already covered.
    if (page.url !== url) {
      if (seen.has(page.url)) continue;
      seen.add(page.url);
    }

    const stored = await options.onPage(page);
    if (stored === false) {
      // Put it back: the caller stopped, so this page is still outstanding.
      queue.unshift(page.url);
      break;
    }
    ingested++;

    // Link mode discovers as it goes. Sitemap mode already knows every URL, so
    // scraping hrefs would only add duplicates and query-string variants.
    if (options.discovery === 'links') {
      const frontierLimit = options.frontierLimit ?? options.pageLimit;
      const room = frontierLimit - (options.alreadyIngested + ingested) - queue.length;
      if (room > 0) {
        const links = rankCrawlUrls(
          extractSameDomainLinks(page.html, new URL(page.url), options.root),
        ).filter((href) => {
          if (seen.has(href) || queue.includes(href)) return false;
          try {
            return pathDepth(new URL(href)) <= MAX_CRAWL_DEPTH;
          } catch {
            return false;
          }
        });
        discoveredExtra += links.length;
        queue.push(...links.slice(0, room));
      }
    }
  }

  const skipped =
    options.alreadyIngested + ingested >= options.pageLimit ? queue.length + discoveredExtra : 0;

  return { ingested, failed, remaining: queue, skipped };
}

// --- Onboarding gap prompts -------------------------------------------------

/**
 * What the imported site did NOT say. Unchanged in substance from the original
 * onboarding importer, but it now runs over the crawled pages' combined text
 * rather than the single merged document that no longer exists.
 */
export function missingWebsitePrompts(text: string): string[] {
  const prompts: string[] = [];
  if (!/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) && !/\+?\d[\d\s().-]{7,}/.test(text)) {
    prompts.push('Add the best phone, WhatsApp, or email for customer follow-up.');
  }
  if (
    !/\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|hours|opening)\b/i.test(
      text,
    )
  ) {
    prompts.push('Add business hours or tell the bot how to handle after-hours messages.');
  }
  if (!/\b(refund|return|shipping|delivery|cancellation|warranty|policy)\b/i.test(text)) {
    prompts.push('Add delivery, refund, return, or cancellation policy if customers ask about it.');
  }
  if (!/\b(price|pricing|service|services|product|products|shop|catalog|catalogue)\b/i.test(text)) {
    prompts.push('Add services/products and prices, or connect a catalogue/integration.');
  }
  if (!/\b(book|appointment|schedule|quote|callback|consultation)\b/i.test(text)) {
    prompts.push('Choose what lead details the bot should collect before handing to your team.');
  }
  return prompts.slice(0, 5);
}
