import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getHelpArticle,
  getHelpDocument,
  helpArticlePath,
  helpCategoryPath,
  helpCenterPath,
  helpCenterUrl,
} from '@/modules/help-center/data';
import { ArticleBody, summarize } from '@/modules/help-center/markdown';
import {
  ArticleCardList,
  HelpFooter,
  HelpHeader,
  JsonLd,
} from '@/modules/help-center/help-center-list';

/**
 * One public article.
 *
 * TWO KINDS OF ADDRESS, ONE ROUTE
 * `/help/<handle>/<slug>` is an article somebody wrote. `/help/<handle>/<uuid>`
 * is a knowledge document, which is the only shape this feature could produce
 * before migration 0078 — and customers have already published those links.
 * Both resolve here: the slug is tried first, and only a UUID-shaped segment
 * falls through to the document reader, so an article can never be shadowed by
 * an id and no existing link 404s.
 *
 * Draft articles are unreachable: `getHelpArticle` filters on
 * `status = 'published'`, so a draft's URL is a 404 for everyone, signed in or
 * not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: { handle: string; slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await getHelpArticle(params.handle, params.slug);

  if (!found) {
    // A legacy document has no SEO fields of its own and is not the canonical
    // shape of a help page, so it is deliberately kept out of the index rather
    // than competing with the article that replaces it.
    if (UUID.test(params.slug)) {
      const doc = await getHelpDocument(params.handle, params.slug);
      if (doc) {
        return {
          title: `${doc.title} — ${doc.brand.title}`,
          description: summarize(doc.text, 160),
          robots: { index: false, follow: true },
        };
      }
    }
    return { title: 'Article', robots: { index: false, follow: false } };
  }

  const { brand, article } = found;
  const canonical = helpCenterUrl(helpArticlePath(brand.handle, article.slug));
  const description = article.seoDescription || article.excerpt || summarize(article.body, 160);

  return {
    title: `${article.seoTitle || article.title} — ${brand.title}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: article.seoTitle || article.title,
      description,
      url: canonical,
      type: 'article',
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.updatedAt,
    },
    twitter: { card: 'summary', title: article.seoTitle || article.title, description },
    robots: { index: true, follow: true },
  };
}

export default async function HelpArticlePage({ params }: PageProps) {
  const found = await getHelpArticle(params.handle, params.slug);

  if (!found) {
    if (!UUID.test(params.slug)) notFound();
    const doc = await getHelpDocument(params.handle, params.slug);
    if (!doc) notFound();

    // Plain text, not Markdown: this came out of a PDF or a crawled page and
    // was never written with markup in mind.
    const paragraphs = doc.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    return (
      <main className="min-h-screen bg-slate-50">
        <HelpHeader
          brand={doc.brand}
          crumb={{ href: helpCenterPath(doc.brand.handle), label: doc.brand.title }}
          heading={doc.title}
        />
        <article className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-4 text-[15px] leading-relaxed text-slate-800">
            {paragraphs.length === 0 ? (
              <p className="text-slate-500">This page has no content yet.</p>
            ) : (
              paragraphs.map((paragraph, i) => (
                <p key={i} className="whitespace-pre-wrap">
                  {paragraph}
                </p>
              ))
            )}
          </div>
        </article>
        <HelpFooter brand={doc.brand} />
      </main>
    );
  }

  const { brand, article, siblings } = found;
  const canonical = helpCenterUrl(helpArticlePath(brand.handle, article.slug));

  return (
    <main className="min-h-screen bg-slate-50">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: article.title,
          description: article.seoDescription || article.excerpt,
          datePublished: article.publishedAt ?? undefined,
          dateModified: article.updatedAt,
          mainEntityOfPage: canonical,
          author: { '@type': 'Organization', name: brand.name },
          publisher: { '@type': 'Organization', name: brand.name },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: brand.title,
              item: helpCenterUrl(helpCenterPath(brand.handle)),
            },
            ...(article.category
              ? [
                  {
                    '@type': 'ListItem',
                    position: 2,
                    name: article.category.name,
                    item: helpCenterUrl(helpCategoryPath(brand.handle, article.category.slug)),
                  },
                ]
              : []),
            {
              '@type': 'ListItem',
              position: article.category ? 3 : 2,
              name: article.title,
              item: canonical,
            },
          ],
        }}
      />

      <HelpHeader
        brand={brand}
        crumb={
          article.category
            ? {
                href: helpCategoryPath(brand.handle, article.category.slug),
                label: article.category.name,
              }
            : { href: helpCenterPath(brand.handle), label: brand.title }
        }
        heading={article.title}
        tagline={article.excerpt}
      />

      <article className="mx-auto max-w-3xl px-6 py-8 text-slate-800">
        <ArticleBody source={article.body} />
      </article>

      {siblings.length > 0 && article.category ? (
        <section className="mx-auto max-w-3xl space-y-3 px-6 pb-10">
          <h2 className="text-lg font-semibold text-slate-900">More in {article.category.name}</h2>
          <ArticleCardList brand={brand} articles={siblings} />
          <Link
            href={helpCategoryPath(brand.handle, article.category.slug)}
            className="inline-block text-sm text-slate-600 hover:underline"
          >
            See everything in {article.category.name}
          </Link>
        </section>
      ) : null}

      <HelpFooter brand={brand} />
    </main>
  );
}
