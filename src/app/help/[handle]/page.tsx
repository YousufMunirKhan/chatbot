import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getHelpCenterIndex,
  helpCenterPath,
  helpCenterUrl,
  searchHelpCenter,
} from '@/modules/help-center/data';
import {
  ArticleCardList,
  CategorySection,
  DocumentSection,
  EmptyHelpCenter,
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
 *
 * EMPTY IS NOT MISSING
 * Every company has a handle (migration 0087), so this page answers for all of
 * them. One with nothing published says so and asks a crawler not to index it —
 * a thin page in the index is worse for the company than no page at all — while
 * a company that has switched its help centre off still 404s, which is what
 * switching it off means.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { handle: string };
  searchParams: { q?: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // The index, not just the brand: whether anything is published decides
  // whether this page asks to be indexed, and the read is cached per request so
  // the page below pays nothing for it.
  const index = await getHelpCenterIndex(params.handle);
  if (!index) return { title: 'Help Center', robots: { index: false, follow: false } };

  const { brand } = index;
  const canonical = helpCenterUrl(helpCenterPath(brand.handle));
  const description =
    brand.description || `Guides, answers and frequently asked questions from ${brand.name}.`;

  return {
    title: brand.title,
    description,
    alternates: { canonical },
    openGraph: { title: brand.title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary', title: brand.title, description },
    // An empty help centre is a page worth serving and not a page worth
    // indexing. `follow` stays on so a crawler that lands here still walks out
    // through the links in the footer.
    robots: { index: index.articleCount + index.documents.length > 0, follow: true },
  };
}

export default async function HelpCenterIndexPage({ params, searchParams }: PageProps) {
  const index = await getHelpCenterIndex(params.handle);
  if (!index) notFound();
  const { brand, categories, uncategorized, documents } = index;

  const nothingWritten = categories.length === 0 && uncategorized.length === 0 && documents.length === 0;
  const query = (searchParams.q ?? '').trim().slice(0, 200);
  // Nothing to search means nothing to ask Postgres. A visitor who arrives with
  // ?q= in the URL of an empty help centre gets the empty page, not an
  // apologetic "no results" over the top of it.
  const hits = query && !nothingWritten ? await searchHelpCenter(brand, query) : [];

  return (
    <main className="min-h-screen bg-slate-50">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: brand.title,
          url: helpCenterUrl(helpCenterPath(brand.handle)),
          publisher: { '@type': 'Organization', name: brand.name },
          // Advertised only while there is something to find. A search box a
          // crawler can offer in the results page, over a help centre with
          // nothing in it, is a promise the site cannot keep.
          ...(nothingWritten
            ? {}
            : {
                potentialAction: {
                  '@type': 'SearchAction',
                  target: `${helpCenterUrl(helpCenterPath(brand.handle))}?q={search_term_string}`,
                  'query-input': 'required name=search_term_string',
                },
              }),
        }}
      />

      <HelpHeader
        brand={brand}
        heading={brand.title}
        tagline={brand.description || 'Find answers, guides and frequently asked questions.'}
      />

      <div className="mx-auto max-w-3xl space-y-10 px-6 py-8">
        {/* A search box over nothing is a box that can only disappoint. */}
        {nothingWritten ? null : <HelpSearchBox brand={brand} query={query} />}

        {query && !nothingWritten ? <SearchResults hits={hits} query={query} /> : null}

        {nothingWritten ? (
          <EmptyHelpCenter brand={brand} />
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
