import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getHelpCategory,
  helpCategoryPath,
  helpCenterPath,
  helpCenterUrl,
} from '@/modules/help-center/data';
import {
  ArticleCardList,
  HelpFooter,
  HelpHeader,
  HelpSearchBox,
  JsonLd,
} from '@/modules/help-center/help-center-list';

/**
 * One section of the help centre, at its own address.
 *
 * A section needs a URL of its own for two reasons: a reader browsing "Refunds"
 * should be able to send someone that page, and a search engine indexing a
 * fifty-article help centre needs somewhere to land other than one enormous
 * index. `category` is a reserved slug (see `slug.ts`), so this static segment
 * can never be shadowed by an article named the same thing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { handle: string; categorySlug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const found = await getHelpCategory(params.handle, params.categorySlug);
  if (!found) return { title: 'Help Center', robots: { index: false, follow: false } };

  const { brand, category } = found;
  const canonical = helpCenterUrl(helpCategoryPath(brand.handle, category.slug));
  const description =
    category.description || `${category.name} — help articles and answers from ${brand.name}.`;

  return {
    title: `${category.name} — ${brand.title}`,
    description,
    alternates: { canonical },
    openGraph: { title: category.name, description, url: canonical, type: 'website' },
    // An empty section is a thin page. Let a crawler follow the links out of it
    // without adding the page itself to the index.
    robots: { index: category.articles.length > 0, follow: true },
  };
}

export default async function HelpCategoryPage({ params }: PageProps) {
  const found = await getHelpCategory(params.handle, params.categorySlug);
  if (!found) notFound();
  const { brand, category } = found;

  return (
    <main className="min-h-screen bg-slate-50">
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
            {
              '@type': 'ListItem',
              position: 2,
              name: category.name,
              item: helpCenterUrl(helpCategoryPath(brand.handle, category.slug)),
            },
          ],
        }}
      />

      <HelpHeader
        brand={brand}
        crumb={{ href: helpCenterPath(brand.handle), label: brand.title }}
        heading={category.name}
        tagline={category.description ?? undefined}
      />

      <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <HelpSearchBox brand={brand} query="" />
        {category.articles.length === 0 ? (
          <p className="text-center text-slate-600">Nothing has been published in this section yet.</p>
        ) : (
          <ArticleCardList brand={brand} articles={category.articles} />
        )}
      </div>

      <HelpFooter brand={brand} />
    </main>
  );
}
