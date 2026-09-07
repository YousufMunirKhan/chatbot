/**
 * Slugs for the help centre.
 *
 * A slug is part of a public URL, so it is also part of the SEO surface and of
 * whatever a customer bookmarks. Two rules follow from that: it has to be
 * stable enough to keep, and it has to be narrow enough that no slug can ever
 * be mistaken for something else in the same path segment.
 *
 * The second rule is load-bearing. `/help/<handle>` accepts EITHER a company's
 * own help-centre handle or a bot's `public_bot_id`, which migration 0002
 * defines as a UUID with the hyphens stripped — 32 hexadecimal characters. If a
 * company were allowed to take that shape as its handle it could shadow another
 * company's help centre, so `isReservedHandle` rejects it and every handle write
 * goes through that check.
 */

/** Path segments the help centre routes own; an article may not claim one. */
const RESERVED_SLUGS = new Set(['category', 'search', 'sitemap.xml', 'robots.txt', 'api', 'new']);

/** A bot's public id: `replace(gen_random_uuid()::text,'-','')`. */
const BOT_ID_SHAPE = /^[0-9a-f]{32}$/;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/**
 * Turn a heading into a URL segment.
 *
 * Non-Latin text — this product is Arabic and English — leaves nothing behind
 * once the non-ASCII is stripped, so the caller gets an empty string and is
 * expected to fall back to something stable (we use a short id). Returning ''
 * rather than a mangled transliteration keeps that decision at the call site.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

export function isReservedHandle(slug: string): boolean {
  return RESERVED_SLUGS.has(slug) || BOT_ID_SHAPE.test(slug);
}

/** Does this look like a bot's public id rather than a chosen handle? */
export function looksLikeBotId(handle: string): boolean {
  return BOT_ID_SHAPE.test(handle);
}

/**
 * A slug for `title`, guaranteed non-empty and guaranteed not to collide with
 * anything in `taken`. `fallback` covers titles that slugify to nothing (an
 * Arabic heading, an emoji, a row of punctuation).
 */
export function uniqueSlug(title: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(taken);
  const base = slugify(title) || fallback;
  if (!used.has(base) && !RESERVED_SLUGS.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base.slice(0, SLUG_MAX - 5)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, SLUG_MAX - 9)}-${Date.now().toString(36).slice(-6)}`;
}
