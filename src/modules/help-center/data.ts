import { cache } from 'react';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { summarize } from './markdown';
import { looksLikeBotId } from './slug';

/**
 * The PUBLIC side of the help centre — everything an anonymous reader sees.
 *
 * TENANCY, WHICH IS THE WHOLE SECURITY MODEL HERE
 * -----------------------------------------------
 * There is no session on these pages. The reader is a stranger with a URL, so
 * nothing can be derived from who they are; the handle in the path is resolved
 * to exactly one `company_id` first, and every query after that carries it. The
 * service-role client bypasses row-level security, so that filter and the
 * `status = 'published'` filter beside it ARE the boundary. A missing
 * `.eq('company_id', …)` here is a cross-tenant leak, and a missing
 * `.eq('status', 'published')` publishes somebody's unfinished draft.
 *
 * THE HANDLE
 * ----------
 * `/help/<handle>` accepts two things. A company's chosen help-centre slug is
 * the canonical one and is what every link and every `<link rel=canonical>`
 * uses. A bot's `public_bot_id` also resolves, because that is the only address
 * this feature had before migration 0078 and customers have already published
 * those links. Both land on the same content; the canonical tag is what stops
 * a company with three bots from competing against itself in search results.
 *
 * ROUND TRIPS
 * -----------
 * Two per page: one to resolve the handle to a company and its branding, one
 * for the content. The app server and its Postgres are far apart and a round
 * trip costs ~230 ms whatever it asks for, so the count is what matters.
 */

export interface HelpCenterBrand {
  /** Canonical handle — always use this to build a link, never the requested one. */
  handle: string;
  companyId: string;
  /** Whose help centre this is, for the footer. */
  name: string;
  title: string;
  description: string;
  primaryColor: string;
}

export interface HelpArticleCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
}

export interface HelpCategoryBlock {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  articles: HelpArticleCard[];
}

/** A pre-0078 knowledge document, still readable so old links keep working. */
export interface HelpDocumentCard {
  id: string;
  title: string;
  excerpt: string;
}

export interface HelpCenterIndex {
  brand: HelpCenterBrand;
  categories: HelpCategoryBlock[];
  /** Published articles with no category. Rendered after the categories. */
  uncategorized: HelpArticleCard[];
  documents: HelpDocumentCard[];
  articleCount: number;
}

export interface HelpArticleView {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
  category: { id: string; name: string; slug: string } | null;
}

export interface HelpSearchHit {
  kind: 'article' | 'document';
  id: string;
  title: string;
  snippet: string;
  /** Ready to render — already resolved against the canonical handle. */
  href: string;
}

const DEFAULT_COLOR = '#045fff';
const DEFAULT_TITLE = 'Help Center';

/** Absolute origin, no trailing slash — canonical tags and sitemaps need one. */
export function helpCenterOrigin(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}

export function helpCenterPath(handle: string): string {
  return `/help/${encodeURIComponent(handle)}`;
}

export function helpArticlePath(handle: string, slug: string): string {
  return `${helpCenterPath(handle)}/${encodeURIComponent(slug)}`;
}

export function helpCategoryPath(handle: string, slug: string): string {
  return `${helpCenterPath(handle)}/category/${encodeURIComponent(slug)}`;
}

export function helpCenterUrl(path: string): string {
  return `${helpCenterOrigin()}${path}`;
}

function excerptFor(excerpt: string | null | undefined, body: string): string {
  const written = (excerpt ?? '').trim();
  return written || summarize(body, 160);
}

function appearanceColor(appearance: unknown): string {
  const map = (appearance ?? {}) as Record<string, unknown>;
  const color = map.primaryColor;
  return typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// Resolving a handle to a company
// ---------------------------------------------------------------------------

interface SettingsRow {
  company_id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  is_published: boolean;
  companies?: { name?: string } | { name?: string }[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Handle → brand, or null when there is nothing public at that address.
 *
 * Null covers four different situations on purpose, because the reader must not
 * be able to tell them apart: no such handle, a company that has switched its
 * help centre off, an internal-only assistant, and a bot id that does not
 * exist. Every one of them is a 404.
 */
export const resolveHelpCenter = cache(async function resolveHelpCenter(
  handle: string,
): Promise<HelpCenterBrand | null> {
  const sb = createSupabaseServiceClient();
  const trimmed = handle.trim().toLowerCase();
  if (!trimmed) return null;

  // A 32-character hex handle can only be a bot id (migration 0002 defines it
  // as a UUID with the hyphens removed) and `isReservedHandle` refuses that
  // shape as a chosen slug, so the two namespaces cannot overlap and this needs
  // no second lookup to disambiguate.
  if (!looksLikeBotId(trimmed)) {
    const { data } = await sb
      .from('help_center_settings')
      .select('company_id,slug,title,description,is_published,companies(name)')
      .eq('slug', trimmed)
      .maybeSingle();
    const row = data as SettingsRow | null;
    if (!row || !row.is_published) return null;

    const { data: bot } = await sb
      .from('bots')
      .select('appearance_json')
      .eq('company_id', row.company_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const company = one(row.companies);
    return {
      handle: row.slug ?? trimmed,
      companyId: row.company_id,
      name: company?.name ?? row.title ?? DEFAULT_TITLE,
      title: row.title || `${company?.name ?? ''} ${DEFAULT_TITLE}`.trim(),
      description: row.description ?? '',
      primaryColor: appearanceColor((bot as { appearance_json?: unknown } | null)?.appearance_json),
    };
  }

  // The legacy address. Kept working, but never canonical: if the company has
  // since chosen a handle, every link on the page points at that instead, and
  // so does the canonical tag.
  const { data: bot } = await sb
    .from('bots')
    .select('company_id,name,appearance_json,bot_type,capability_flags,companies(name)')
    .eq('public_bot_id', trimmed)
    .maybeSingle();
  if (!bot) return null;

  const botRow = bot as Record<string, unknown>;
  const appearance = (botRow.appearance_json ?? {}) as Record<string, unknown>;
  const flags = (botRow.capability_flags as string[] | null) ?? [];
  // Same rule the widget uses: an internal assistant has no public audience, so
  // it has no public help centre either.
  const internal =
    appearance.assistantAudience === 'internal' ||
    botRow.bot_type === 'internal' ||
    flags.some((flag) => flag.startsWith('internal_'));
  if (internal) return null;

  const companyId = botRow.company_id as string;
  const { data: settings } = await sb
    .from('help_center_settings')
    .select('company_id,slug,title,description,is_published')
    .eq('company_id', companyId)
    .maybeSingle();
  const row = settings as SettingsRow | null;
  if (row && !row.is_published) return null;

  const companyName = one(botRow.companies as { name?: string } | { name?: string }[] | null)?.name;
  const botName = (botRow.name as string) ?? '';
  return {
    handle: row?.slug ?? trimmed,
    companyId,
    name: companyName ?? botName,
    title:
      row?.title ||
      (appearance.helpCenterTitle as string) ||
      `${companyName ?? botName} ${DEFAULT_TITLE}`.trim(),
    description: row?.description ?? '',
    primaryColor: appearanceColor(appearance),
  };
});

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

const ARTICLE_CARD_COLUMNS = 'id,title,slug,excerpt,body,category_id,position' as const;

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  category_id: string | null;
  position: number;
}

function toCard(row: ArticleRow): HelpArticleCard {
  return {
    id: row.id,
    title: row.title || 'Untitled',
    slug: row.slug,
    excerpt: excerptFor(row.excerpt, row.body),
  };
}

/**
 * Everything on the landing page.
 *
 * The knowledge documents at the bottom are the surface this page used to BE.
 * They stay because live customers already have help centres made entirely of
 * them, and shipping a version where all of that vanished would be a
 * regression dressed as a feature. Articles this module indexed for the
 * assistant are excluded by their `source_url` marker, or every published
 * article would appear twice.
 */
export async function getHelpCenterIndex(handle: string): Promise<HelpCenterIndex | null> {
  const brand = await resolveHelpCenter(handle);
  if (!brand) return null;
  const sb = createSupabaseServiceClient();

  const [categoriesRes, articlesRes, documentsRes] = await Promise.all([
    sb
      .from('help_categories')
      .select('id,name,slug,description,position')
      .eq('company_id', brand.companyId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    sb
      .from('help_articles')
      .select(ARTICLE_CARD_COLUMNS)
      .eq('company_id', brand.companyId)
      .eq('status', 'published')
      .order('position', { ascending: true })
      .order('title', { ascending: true }),
    sb
      .from('documents')
      .select('id,title,document_sources(raw_text)')
      .eq('company_id', brand.companyId)
      .in('audience', ['customer', 'both'])
      .eq('status', 'ready')
      // `source_url NOT LIKE …` is NULL — and therefore false — for the many
      // documents that have no URL at all, so the null case has to be spelled
      // out or this list comes back empty. PostgREST's `like` takes `*`, not `%`.
      .or('source_url.is.null,source_url.not.like.help-article:*')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const byCategory = new Map<string, HelpArticleCard[]>();
  const uncategorized: HelpArticleCard[] = [];
  let articleCount = 0;
  for (const row of (articlesRes.data ?? []) as ArticleRow[]) {
    const card = toCard(row);
    articleCount += 1;
    if (!row.category_id) uncategorized.push(card);
    else byCategory.set(row.category_id, [...(byCategory.get(row.category_id) ?? []), card]);
  }

  const categories: HelpCategoryBlock[] = ((categoriesRes.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: (row.description as string | null) ?? null,
      articles: byCategory.get(row.id as string) ?? [],
    }))
    // An empty category is a heading with nothing under it — noise to a reader,
    // and a thin page to a crawler. It stays in the dashboard, not out here.
    .filter((category) => category.articles.length > 0);

  const documents: HelpDocumentCard[] = ((documentsRes.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const sources = row.document_sources as Array<{ raw_text?: string }> | { raw_text?: string } | null;
      const raw = (Array.isArray(sources) ? sources[0]?.raw_text : sources?.raw_text) ?? '';
      return {
        id: row.id as string,
        title: (row.title as string) || 'Untitled',
        excerpt: summarize(raw, 160),
      };
    },
  );

  return { brand, categories, uncategorized, documents, articleCount };
}

/** One category page: its own articles, for browsing and for a crawlable URL. */
export const getHelpCategory = cache(async function getHelpCategory(
  handle: string,
  categorySlug: string,
): Promise<{ brand: HelpCenterBrand; category: HelpCategoryBlock } | null> {
  const brand = await resolveHelpCenter(handle);
  if (!brand) return null;
  const sb = createSupabaseServiceClient();

  const { data } = await sb
    .from('help_categories')
    .select('id,name,slug,description')
    .eq('company_id', brand.companyId) // tenant boundary
    .eq('slug', categorySlug)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;

  const { data: articles } = await sb
    .from('help_articles')
    .select(ARTICLE_CARD_COLUMNS)
    .eq('company_id', brand.companyId)
    .eq('category_id', row.id as string)
    .eq('status', 'published')
    .order('position', { ascending: true })
    .order('title', { ascending: true });

  return {
    brand,
    category: {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: (row.description as string | null) ?? null,
      articles: ((articles ?? []) as ArticleRow[]).map(toCard),
    },
  };
});

// ---------------------------------------------------------------------------
// One article
// ---------------------------------------------------------------------------

export const getHelpArticle = cache(async function getHelpArticle(
  handle: string,
  slug: string,
): Promise<{ brand: HelpCenterBrand; article: HelpArticleView; siblings: HelpArticleCard[] } | null> {
  const brand = await resolveHelpCenter(handle);
  if (!brand) return null;
  const sb = createSupabaseServiceClient();

  const { data } = await sb
    .from('help_articles')
    .select(
      'id,title,slug,excerpt,body,seo_title,seo_description,published_at,updated_at,category_id,help_categories(id,name,slug)',
    )
    .eq('company_id', brand.companyId) // tenant boundary
    .eq('slug', slug)
    .eq('status', 'published') // …and this is what keeps drafts private
    .maybeSingle();
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const category = one(row.help_categories as Record<string, unknown> | Record<string, unknown>[] | null);
  const body = (row.body as string) ?? '';

  const article: HelpArticleView = {
    id: row.id as string,
    title: (row.title as string) || 'Untitled',
    slug: row.slug as string,
    excerpt: excerptFor(row.excerpt as string | null, body),
    body,
    seoTitle: (row.seo_title as string | null) ?? null,
    seoDescription: (row.seo_description as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
    category: category
      ? { id: category.id as string, name: category.name as string, slug: category.slug as string }
      : null,
  };

  // "More in this section" — the reason someone reads a second article. Only
  // worth a round trip when there IS a section to read more of.
  let siblings: HelpArticleCard[] = [];
  if (article.category) {
    const { data: rest } = await sb
      .from('help_articles')
      .select(ARTICLE_CARD_COLUMNS)
      .eq('company_id', brand.companyId)
      .eq('category_id', article.category.id)
      .eq('status', 'published')
      .neq('id', article.id)
      .order('position', { ascending: true })
      .limit(5);
    siblings = ((rest ?? []) as ArticleRow[]).map(toCard);
  }

  return { brand, article, siblings };
});

/**
 * A pre-0078 knowledge document, reached by the UUID URLs this feature used to
 * hand out. Same audience and status rules the old page enforced.
 */
export const getHelpDocument = cache(async function getHelpDocument(
  handle: string,
  documentId: string,
): Promise<{ brand: HelpCenterBrand; title: string; text: string } | null> {
  const brand = await resolveHelpCenter(handle);
  if (!brand) return null;

  const { data } = await createSupabaseServiceClient()
    .from('documents')
    .select('id,title,audience,status,document_sources(raw_text)')
    .eq('company_id', brand.companyId) // tenant boundary
    .eq('id', documentId)
    .maybeSingle();
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const audience = row.audience as string;
  if (audience !== 'customer' && audience !== 'both') return null;
  if (row.status !== 'ready') return null;

  const sources = row.document_sources as Array<{ raw_text?: string }> | { raw_text?: string } | null;
  return {
    brand,
    title: (row.title as string) || 'Untitled',
    text: (Array.isArray(sources) ? sources[0]?.raw_text : sources?.raw_text) ?? '',
  };
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface SearchRow {
  kind: string;
  id: string;
  slug: string | null;
  title: string | null;
  snippet: string | null;
}

/**
 * Postgres full-text over both surfaces at once — see `search_help_centre` in
 * migration 0078. `p_published_only` is passed explicitly rather than left to
 * the default: this is the public path, and the argument that keeps drafts out
 * of it should be visible at the call site.
 */
export async function searchHelpCenter(
  brand: HelpCenterBrand,
  query: string,
  limit = 20,
): Promise<HelpSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await createSupabaseServiceClient().rpc('search_help_centre', {
    p_company_id: brand.companyId, // tenant boundary
    p_query: trimmed,
    p_published_only: true,
    p_limit: limit,
  });

  if (error) {
    // A failed search must not take the page down with it — the reader still
    // has the browsable index underneath.
    logger.error('Help centre search failed', { companyId: brand.companyId, error: error.message });
    return [];
  }

  return ((data ?? []) as SearchRow[]).map((row) => ({
    kind: row.kind === 'article' ? 'article' : 'document',
    id: row.id,
    title: row.title || 'Untitled',
    snippet: (row.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    href:
      row.kind === 'article' && row.slug
        ? helpArticlePath(brand.handle, row.slug)
        : `${helpCenterPath(brand.handle)}/${row.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

/** Every crawlable URL of one company's help centre, for `sitemap.xml`. */
export async function getHelpCenterSitemap(handle: string): Promise<SitemapEntry[] | null> {
  const brand = await resolveHelpCenter(handle);
  if (!brand) return null;
  const sb = createSupabaseServiceClient();

  const [articlesRes, categoriesRes] = await Promise.all([
    sb
      .from('help_articles')
      .select('slug,updated_at')
      .eq('company_id', brand.companyId)
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(5000),
    sb
      .from('help_categories')
      .select('slug,updated_at')
      .eq('company_id', brand.companyId)
      .limit(500),
  ]);

  const articles = (articlesRes.data ?? []) as Array<{ slug: string; updated_at: string }>;
  const newest = articles[0]?.updated_at ?? null;

  return [
    { loc: helpCenterUrl(helpCenterPath(brand.handle)), lastmod: newest },
    ...((categoriesRes.data ?? []) as Array<{ slug: string; updated_at: string }>).map((row) => ({
      loc: helpCenterUrl(helpCategoryPath(brand.handle, row.slug)),
      lastmod: row.updated_at,
    })),
    ...articles.map((row) => ({
      loc: helpCenterUrl(helpArticlePath(brand.handle, row.slug)),
      lastmod: row.updated_at,
    })),
  ];
}
