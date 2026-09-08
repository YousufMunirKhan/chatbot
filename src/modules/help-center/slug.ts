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
 * The handle a company gets when nobody picks one.
 *
 * Derived from the company's own slug, which every company has and which is
 * already unique, so the address they get for free reads like the one they
 * would have chosen. This is the same derivation migration 0087 performs in
 * SQL, for the same reason and in the same order — the database does it for
 * companies that already existed and for every company created from now on,
 * this does it when an owner clears the address field and expects a sensible
 * default back rather than a 404. If one changes, change both.
 *
 * The result is a BASE, not a final handle: it can still collide with a handle
 * another company chose, so the caller checks and falls through to
 * `uniqueSlug`.
 */
export function defaultHandle(
  companySlug: string | null | undefined,
  companyName: string,
  companyId: string,
): string {
  const base = slugify(companySlug ?? '') || slugify(companyName);
  // Nothing survived: an Arabic or emoji-only name. The id is the only thing
  // every company is guaranteed to have.
  if (!base) return `help-${companyId.replace(/-/g, '').slice(0, 8)}`;
  // A reserved word or a bot-id shape would shadow a route or another
  // company's help centre, so it is pushed out of that namespace rather than
  // rejected — the owner asked for a default, not for an error.
  return isReservedHandle(base)
    ? `${base.slice(0, SLUG_MAX - 5).replace(/-+$/g, '')}-help`
    : base;
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
