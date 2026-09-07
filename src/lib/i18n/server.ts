import { cache } from 'react';
import { getSessionUser } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getDictionary, normalizeLocale, dirFor, type Dictionary, type Locale } from './index';

/**
 * Resolve the signed-in company's locale once per request.
 *
 * `cache()` is React's per-request memo, so the shell and every page inside it
 * share ONE `companies` read no matter how many of them ask. That is the whole
 * reason this lives beside the dictionaries instead of each page doing its own
 * lookup: `t()` stays pure, and translation costs the request nothing beyond
 * the query the layout was already making for the company name.
 *
 * Falls back to English on any failure — a page must never fail to render
 * because the language could not be read.
 */
export interface CompanyLocaleInfo {
  companyId: string | null;
  /** The company's display name; `null` for a platform-only super admin. */
  companyName: string | null;
  locale: Locale;
  dir: 'ltr' | 'rtl';
  dict: Dictionary;
}

export const getCompanyLocaleInfo = cache(async function getCompanyLocaleInfo(): Promise<CompanyLocaleInfo> {
  const fallback: CompanyLocaleInfo = {
    companyId: null,
    companyName: null,
    locale: 'en',
    dir: 'ltr',
    dict: getDictionary('en'),
  };
  try {
    const user = await getSessionUser();
    if (!user?.companyId) return fallback;
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('companies')
      .select('name,default_language')
      .eq('id', user.companyId)
      .maybeSingle();
    const row = data as { name?: string; default_language?: string } | null;
    const locale = normalizeLocale(row?.default_language);
    return {
      companyId: user.companyId,
      companyName: row?.name ?? null,
      locale,
      dir: dirFor(locale),
      dict: getDictionary(locale),
    };
  } catch {
    return fallback;
  }
});

/** Just the dictionary, for a page that does not need the rest. */
export async function getRequestDictionary(): Promise<Dictionary> {
  return (await getCompanyLocaleInfo()).dict;
}
