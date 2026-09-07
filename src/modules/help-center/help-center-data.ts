import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from '@/modules/company/data';
import { summarize } from './markdown';
import { helpCenterPath, helpCenterUrl } from './data';

/**
 * The DASHBOARD side of the help centre — what the person writing sees.
 *
 * Everything here is bound to the session user's own company id, taken from
 * `getCompanyId()` and never from a route parameter or a form field. The
 * service-role client bypasses RLS, so that filter is the tenant boundary, the
 * same rule the rest of the data layer follows.
 *
 * Unlike `data.ts`, these reads deliberately do NOT filter by status: the whole
 * job of this side is to show the drafts.
 */

export interface HelpArticleRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  status: 'draft' | 'published';
  position: number;
  categoryId: string | null;
  categoryName: string | null;
  publishedAt: string | null;
  updatedAt: string;
  /** True once the assistant has this article in its knowledge index. */
  indexed: boolean;
}

export interface HelpCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  articleCount: number;
  publishedCount: number;
}

export interface HelpCenterSettings {
  /** Null until an owner picks a handle; the bot-id URL is used meanwhile. */
  slug: string | null;
  title: string;
  description: string;
  isPublished: boolean;
}

export interface HelpCenterOverview {
  settings: HelpCenterSettings;
  categories: HelpCategoryRow[];
  articles: HelpArticleRow[];
  publishedCount: number;
  draftCount: number;
  /** Where a reader would land. Null when the company has no public bot yet. */
  publicUrl: string | null;
  /** The handle in that URL, so the page can say which one is in use. */
  publicHandle: string | null;
  /** True when the URL above is only a bot id because no handle is set. */
  usingBotId: boolean;
}

const DEFAULT_TITLE = 'Help Center';

interface RawArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  status: string;
  position: number;
  category_id: string | null;
  published_at: string | null;
  updated_at: string;
  knowledge_document_id: string | null;
  help_categories?: { name?: string } | { name?: string }[] | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

function toArticleRow(raw: RawArticle): HelpArticleRow {
  const category = one(raw.help_categories);
  return {
    id: raw.id,
    title: raw.title || 'Untitled',
    slug: raw.slug,
    excerpt: (raw.excerpt ?? '').trim() || summarize(raw.body ?? '', 120),
    status: raw.status === 'published' ? 'published' : 'draft',
    position: raw.position,
    categoryId: raw.category_id,
    categoryName: category?.name ?? null,
    publishedAt: raw.published_at,
    updatedAt: raw.updated_at,
    indexed: Boolean(raw.knowledge_document_id),
  };
}

const ARTICLE_COLUMNS =
  'id,title,slug,excerpt,body,status,position,category_id,published_at,updated_at,knowledge_document_id' as const;

/**
 * The whole management screen in four round trips: settings, categories,
 * articles, and the bot that supplies the fallback public handle.
 */
export async function getHelpCenterOverview(): Promise<HelpCenterOverview> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [settingsRes, categoriesRes, articlesRes, botRes] = await Promise.all([
    sb
      .from('help_center_settings')
      .select('slug,title,description,is_published')
      .eq('company_id', companyId)
      .maybeSingle(),
    sb
      .from('help_categories')
      .select('id,name,slug,description,position')
      .eq('company_id', companyId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    sb
      .from('help_articles')
      .select(`${ARTICLE_COLUMNS},help_categories(name)`)
      .eq('company_id', companyId)
      .order('position', { ascending: true })
      .order('updated_at', { ascending: false }),
    // Only for the fallback URL. Oldest bot wins so the address a company sees
    // here does not move about when they add a second assistant.
    sb
      .from('bots')
      .select('public_bot_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const rawSettings = settingsRes.data as
    | { slug: string | null; title: string; description: string | null; is_published: boolean }
    | null;

  const settings: HelpCenterSettings = {
    slug: rawSettings?.slug ?? null,
    title: rawSettings?.title || DEFAULT_TITLE,
    description: rawSettings?.description ?? '',
    // No row yet means nobody has switched it off, and the public pages already
    // treat a missing row as visible. Defaulting to true here keeps the two
    // halves telling the same story.
    isPublished: rawSettings ? rawSettings.is_published : true,
  };

  const articles = ((articlesRes.data ?? []) as RawArticle[]).map(toArticleRow);

  const counts = new Map<string, { total: number; published: number }>();
  for (const article of articles) {
    if (!article.categoryId) continue;
    const entry = counts.get(article.categoryId) ?? { total: 0, published: 0 };
    entry.total += 1;
    if (article.status === 'published') entry.published += 1;
    counts.set(article.categoryId, entry);
  }

  const categories: HelpCategoryRow[] = ((categoriesRes.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => {
      const id = row.id as string;
      const count = counts.get(id) ?? { total: 0, published: 0 };
      return {
        id,
        name: row.name as string,
        slug: row.slug as string,
        description: (row.description as string | null) ?? null,
        position: (row.position as number) ?? 0,
        articleCount: count.total,
        publishedCount: count.published,
      };
    },
  );

  const botHandle = (botRes.data as { public_bot_id?: string } | null)?.public_bot_id ?? null;
  const handle = settings.slug ?? botHandle;

  return {
    settings,
    categories,
    articles,
    publishedCount: articles.filter((a) => a.status === 'published').length,
    draftCount: articles.filter((a) => a.status === 'draft').length,
    publicUrl: handle ? helpCenterUrl(helpCenterPath(handle)) : null,
    publicHandle: handle,
    usingBotId: Boolean(handle) && !settings.slug,
  };
}

export interface HelpArticleEditor {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: 'draft' | 'published';
  seoTitle: string;
  seoDescription: string;
  categoryId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  indexed: boolean;
  /** Null when the company has no public handle and no bot to fall back on. */
  publicUrl: string | null;
  /**
   * The handle inside that URL. The editor rebuilds the address live as the
   * writer edits the slug, so it needs the pieces, not the finished string.
   */
  publicHandle: string | null;
  categories: Array<{ id: string; name: string }>;
}

/** One article, for the editor. Null when it is not this company's. */
export async function getHelpArticleForEdit(articleId: string): Promise<HelpArticleEditor | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const [articleRes, categoriesRes, settingsRes, botRes] = await Promise.all([
    sb
      .from('help_articles')
      .select(`${ARTICLE_COLUMNS},seo_title,seo_description`)
      .eq('company_id', companyId) // tenant boundary
      .eq('id', articleId)
      .maybeSingle(),
    sb
      .from('help_categories')
      .select('id,name')
      .eq('company_id', companyId)
      .order('position', { ascending: true })
      .order('name', { ascending: true }),
    sb.from('help_center_settings').select('slug').eq('company_id', companyId).maybeSingle(),
    sb
      .from('bots')
      .select('public_bot_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!articleRes.data) return null;
  const raw = articleRes.data as RawArticle & { seo_title: string | null; seo_description: string | null };

  const handle =
    (settingsRes.data as { slug?: string | null } | null)?.slug ??
    (botRes.data as { public_bot_id?: string } | null)?.public_bot_id ??
    null;

  return {
    id: raw.id,
    title: raw.title,
    slug: raw.slug,
    excerpt: raw.excerpt ?? '',
    body: raw.body ?? '',
    status: raw.status === 'published' ? 'published' : 'draft',
    seoTitle: raw.seo_title ?? '',
    seoDescription: raw.seo_description ?? '',
    categoryId: raw.category_id,
    publishedAt: raw.published_at,
    updatedAt: raw.updated_at,
    indexed: Boolean(raw.knowledge_document_id),
    publicUrl: handle ? helpCenterUrl(`${helpCenterPath(handle)}/${encodeURIComponent(raw.slug)}`) : null,
    publicHandle: handle,
    categories: ((categoriesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
  };
}
