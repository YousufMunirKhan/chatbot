import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getHelpCenterIndex,
  helpCenterPath,
  helpCenterUrl,
  resolveHelpCenter,
  searchHelpCenter,
} from '@/modules/help-center/data';
import {
  ArticleCardList,
  CategorySection,
  DocumentSection,
  HelpFooter,
  HelpHeader,
  HelpSearchBox,
  JsonLd,
  SearchResults,
} from '@/modules/help-center/help-center-list';

/**
 * The public help centre index.
 *
 * ANONYMOUS BY DESIGN
 * There is no session here and there must not be one: the reader is a customer
 * who has not signed in to anything. The handle in the URL is resolved to a
 * single company and every read is filtered by that id and by
 * `status = 'published'` — those two filters are the tenant boundary and the
 * draft boundary, because the service-role client bypasses RLS.
 *
 * FINDABLE
 * The canonical URL always uses the company's own handle even when the reader
 * arrived through a bot id, so a business with three assistants has one address
 * in the index instead of three copies competing with each other.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { handle: string };
  searchParams: { q?: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const brand = await resolveHelpCenter(params.handle);
  if (!brand) return { title: 'Help Center', robots: { index: false, follow: false } };

  const canonical = helpCenterUrl(helpCenterPath(brand.handle));
  const description =
    brand.description || `Guides, answers and frequently asked questions from ${brand.name}.`;

  return {
    title: brand.title,
    description,
    alternates: { canonical },
    openGraph: { title: brand.title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary', title: brand.title, description },
    robots: { index: true, follow: true },
  };
}

export default async function HelpCenterIndexPage({ params, searchParams }: PageProps) {
  const index = await getHelpCenterIndex(params.handle);
  if (!index) notFound();
  const { brand, categories, uncategorized, documents } = index;

  const query = (searchParams.q ?? '').trim().slice(0, 200);
  const hits = query ? await searchHelpCenter(brand, query) : [];
  const nothingWritten = categories.length === 0 && uncategorized.length === 0 && documents.length === 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: brand.title,
          url: helpCenterUrl(helpCenterPath(brand.handle)),
          publisher: { '@type': 'Organization', name: brand.name },
          potentialAction: {
            '@type': 'SearchAction',
            target: `${helpCenterUrl(helpCenterPath(brand.handle))}?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        }}
      />

      <HelpHeader
        brand={brand}
        heading={brand.title}
        tagline={brand.description || 'Find answers, guides and frequently asked questions.'}
      />

      <div className="mx-auto max-w-3xl space-y-10 px-6 py-8">
        <HelpSearchBox brand={brand} query={query} />

        {query ? <SearchResults hits={hits} query={query} /> : null}

        {nothingWritten ? (
          <p className="text-center text-slate-600">No published help articles yet.</p>
        ) : (
          <>
            {categories.map((category) => (
              <CategorySection key={category.id} brand={brand} category={category} />
            ))}

            {uncategorized.length > 0 ? (
              <section className="space-y-3">
                {/* Only call it "Other" when there is something to be other
                    THAN. A help centre with no sections at all just has
                    articles. */}
                <h2 className="text-xl font-semibold text-slate-900">
                  {categories.length > 0 ? 'Other articles' : 'Articles'}
                </h2>
                <ArticleCardList brand={brand} articles={uncategorized} />
              </section>
            ) : null}

            <DocumentSection brand={brand} documents={documents} />
          </>
        )}
      </div>

      <HelpFooter brand={brand} />
    </main>
  );
}
