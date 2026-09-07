import { en, type Dictionary, type TranslationKey } from './en';
import { ar } from './ar';

/**
 * Dashboard translation layer (Module 21 completed).
 *
 * The app already switched `dir` for Arabic tenants but every string was still
 * English, so an Arabic company got a right-to-left English dashboard. This is
 * the missing half.
 *
 * Design constraints, in the order they mattered:
 *
 *  - ZERO DEPENDENCIES. Two frozen objects and a `replace()`. Nothing here can
 *    fail at runtime, so no page can fail because a label was missing.
 *  - NO I/O. `getDictionary()` and `t()` are pure and synchronous, which is why
 *    they can be called from a server component's render without adding a query
 *    or a request. The company's locale is resolved once per request in
 *    `./server`, which is `cache()`d — see the note there.
 *  - ALWAYS RETURNS A STRING. `t()` falls back to English and then to the key
 *    itself, so a missing translation degrades to readable text rather than to
 *    `undefined` in the middle of a sentence.
 */

export type Locale = 'en' | 'ar';
export type { Dictionary, TranslationKey };

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

/** RTL locales. Kept as a set so adding Hebrew/Farsi later is one entry. */
const RTL_LOCALES = new Set<Locale>(['ar']);

/**
 * Map a stored `companies.default_language` ('en' | 'ar' | 'auto') onto a
 * locale. 'auto' and anything unrecognised resolve to English — the same
 * behaviour the direction switch already had, so nothing changes for a tenant
 * that never picked a language.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'ar' ? 'ar' : 'en';
}

export function getDictionary(locale: Locale | string | null | undefined): Dictionary {
  return DICTIONARIES[normalizeLocale(typeof locale === 'string' ? locale : null)];
}

export function dirFor(locale: Locale | string | null | undefined): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(normalizeLocale(typeof locale === 'string' ? locale : null)) ? 'rtl' : 'ltr';
}

/**
 * Look up `key` and substitute `{name}` placeholders.
 *
 * A placeholder with no matching variable is left in the string on purpose: a
 * visible `{count}` is a bug report, whereas silently emitting an empty space
 * produces a sentence that reads fine and says the wrong thing.
 */
export function t(
  dict: Dictionary,
  // `string & {}` widens the parameter without collapsing the union, so a
  // literal still autocompletes and typos in a literal are still caught, while
  // a key built at runtime (`settings.section.${slug}.label`) type-checks.
  key: TranslationKey | (string & {}),
  vars?: Record<string, string | number>,
): string {
  const lookup = dict as Record<string, string | undefined>;
  const fallback = en as Record<string, string | undefined>;
  const template = lookup[key] ?? fallback[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Translate a string that may not have a key yet, falling back to the English
 * text the caller already had.
 *
 * This is what lets the shell translate navigation without the nav arrays being
 * rewritten into key form: a route added by another module keeps rendering its
 * hard-coded English label until someone adds `nav.<path>` to the dictionaries.
 */
export function tOr(
  dict: Dictionary,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  const known = (dict as Record<string, string | undefined>)[key];
  if (known === undefined) return fallback;
  return t(dict, key, vars);
}

/**
 * Dictionary key for a navigation href: `/company/inbox` → `nav.company.inbox`.
 * Derived rather than stored so the nav arrays stay exactly as they are.
 */
export function navKey(href: string): string {
  return `nav.${href.replace(/^\/+/, '').replace(/\/+$/, '').split('/').join('.')}`;
}

export { en, ar };
