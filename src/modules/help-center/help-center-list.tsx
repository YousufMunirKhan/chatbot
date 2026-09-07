import Link from 'next/link';
import {
  helpArticlePath,
  helpCategoryPath,
  helpCenterPath,
  type HelpArticleCard,
  type HelpCategoryBlock,
  type HelpCenterBrand,
  type HelpDocumentCard,
  type HelpSearchHit,
} from './data';

/**
 * The public help centre's shared furniture.
 *
 * All server components. The search box that used to live here was a
 * `'use client'` filter over an array of at most 200 rows held in the page —
 * it could not see past that limit, it could not rank, and a reader with
 * JavaScript disabled (or a crawler) got no search at all. It is now a plain
 * `<form method="get">` posting to the same URL, answered by Postgres. That is
 * also why these pages need no client bundle whatsoever, which is what makes
 * them fast on the phone a customer is holding while they are annoyed.
 *
 * Colour comes from the company's own assistant appearance and is applied with
 * inline styles: it is per-tenant data, so it cannot be a Tailwind class.
 */

export function HelpHeader({
  brand,
  crumb,
  heading,
  tagline,
}: {
  brand: HelpCenterBrand;
  /** Shown above the heading, linking back to the index. */
  crumb?: { href: string; label: string };
  heading: string;
  tagline?: string;
}) {
  return (
    <header className="px-6 py-10 text-white" style={{ background: brand.primaryColor }}>
      <div className="mx-auto max-w-3xl">
        {crumb ? (
          <Link href={crumb.href} className="text-sm text-white/80 hover:underline">
            <span aria-hidden="true">←</span> {crumb.label}
          </Link>
        ) : null}
        <h1 className="mt-2 text-3xl font-semibold">{heading}</h1>
        {tagline ? <p className="mt-2 text-white/80">{tagline}</p> : null}
      </div>
    </header>
  );
}

/**
 * A GET form, so the query lives in the URL: shareable, bookmarkable,
 * back-button-able, and answered by the server without a byte of JavaScript.
 */
export function HelpSearchBox({ brand, query }: { brand: HelpCenterBrand; query: string }) {
  return (
    <form method="get" action={helpCenterPath(brand.handle)} role="search" className="flex gap-2">
      <label htmlFor="help-search" className="sr-only">
        Search help articles
      </label>
      <input
        id="help-search"
        name="q"
        type="search"
        defaultValue={query}
        placeholder="Search help articles…"
        className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg px-5 py-3 text-base font-medium text-white"
        style={{ background: brand.primaryColor }}
      >
        Search
      </button>
    </form>
  );
}

export function ArticleLinkCard({
  href,
  title,
  excerpt,
}: {
  href: string;
  title: string;
  excerpt: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
      >
        <p className="font-medium text-slate-900">{title}</p>
        {excerpt ? <p className="mt-1 line-clamp-2 text-sm text-slate-600">{excerpt}</p> : null}
      </Link>
    </li>
  );
}

export function ArticleCardList({
  brand,
  articles,
}: {
  brand: HelpCenterBrand;
  articles: HelpArticleCard[];
}) {
  return (
    <ul className="grid gap-3">
      {articles.map((article) => (
        <ArticleLinkCard
          key={article.id}
          href={helpArticlePath(brand.handle, article.slug)}
          title={article.title}
          excerpt={article.excerpt}
        />
      ))}
    </ul>
  );
}

export function CategorySection({
  brand,
  category,
}: {
  brand: HelpCenterBrand;
  category: HelpCategoryBlock;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          <Link href={helpCategoryPath(brand.handle, category.slug)} className="hover:underline">
            {category.name}
          </Link>
        </h2>
        {category.description ? (
          <p className="mt-1 text-sm text-slate-600">{category.description}</p>
        ) : null}
      </div>
      <ArticleCardList brand={brand} articles={category.articles} />
    </section>
  );
}

/**
 * The knowledge documents this page consisted of before the help centre had
 * articles. Kept, and labelled honestly, because a company whose whole help
 * centre is uploaded PDFs must not open this release to an empty page.
 */
export function DocumentSection({
  brand,
  documents,
}: {
  brand: HelpCenterBrand;
  documents: HelpDocumentCard[];
}) {
  if (documents.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-slate-900">From our knowledge base</h2>
      <ul className="grid gap-3">
        {documents.map((doc) => (
          <ArticleLinkCard
            key={doc.id}
            href={`${helpCenterPath(brand.handle)}/${doc.id}`}
            title={doc.title}
            excerpt={doc.excerpt}
          />
        ))}
      </ul>
    </section>
  );
}

export function SearchResults({ hits, query }: { hits: HelpSearchHit[]; query: string }) {
  if (hits.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-600">
        Nothing matched “{query}”. Try a different word, or browse the sections below.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-slate-600">
        {hits.length === 1 ? '1 result' : `${hits.length} results`} for “{query}”
      </h2>
      <ul className="grid gap-3">
        {hits.map((hit) => (
          <ArticleLinkCard key={`${hit.kind}-${hit.id}`} href={hit.href} title={hit.title} excerpt={hit.snippet} />
        ))}
      </ul>
    </section>
  );
}

export function HelpFooter({ brand }: { brand: HelpCenterBrand }) {
  return (
    <footer className="px-6 py-10 text-center text-xs text-slate-500">
      <Link href={helpCenterPath(brand.handle)} className="hover:underline">
        {brand.title}
      </Link>
      <span aria-hidden="true"> · </span>
      {brand.name}
    </footer>
  );
}

/**
 * Structured data, so a search engine can show the page as an article or a set
 * of answers rather than a blue link. React escapes text children, and this is
 * `JSON.stringify` output of values we built ourselves, so nothing a customer
 * typed reaches the page as markup.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        // `<` is the only character that can end the script element early; the
        // content is machine-generated JSON, never raw HTML.
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
