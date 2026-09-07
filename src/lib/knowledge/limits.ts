/**
 * Every ceiling the knowledge base enforces, in one place.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The old numbers were four `const`s at the top of `knowledge-actions.ts` plus
 * four bare literals buried at call sites — `.slice(0, 50000)` twice,
 * `pages.length >= 8`, `page.text.slice(0, 7000)`. Nobody could state the
 * product's actual limits without reading the file, the UI copy drifted from
 * them, and two of them (the `.slice()` pair) silently threw text away.
 *
 * WHAT THE OLD LIMITS WERE, AND WHY THEY FAILED A REAL SHOP
 * ---------------------------------------------------------
 *   3 uploaded files · 5 MB per file · 10 PDF pages · 20,000 chars per document
 *   50,000 chars for a pasted or imported page · 8 crawled pages, one hop deep
 *
 * A shop with a 40-page catalogue (~120,000 characters) and a 60-page policy
 * PDF fits inside none of them. The catalogue lost five sixths of itself to the
 * 20,000-character slice without a word; the policy PDF was refused outright at
 * page 11.
 *
 * HOW THE NEW NUMBERS WERE CHOSEN — this is a ceiling, not "unlimited"
 * --------------------------------------------------------------------
 * Embedding cost. `chunkText` cuts 900-character chunks on a 750-character
 * stride and `ingestText` embeds each one with the title and a 240-character
 * document context prepended, so roughly 1.57 characters are embedded per raw
 * character, and ~0.39 tokens per raw character. At text-embedding-3-small
 * ($0.02 / 1M tokens) one million raw characters costs about $0.008 to embed;
 * at text-embedding-3-large ($0.13 / 1M) about $0.05. So money is NOT what
 * bounds this — a company sitting on the whole 5,000,000-character allowance
 * below costs about four cents to index from scratch.
 *
 * Time is what bounds it. 5,000,000 characters is ~6,700 chunks, ~70 embedding
 * batches, a couple of minutes of provider round trips plus the chunk inserts.
 * That does not fit in a request, which is exactly why ingestion moved onto the
 * `background_jobs` queue. Per document, {@link MAX_KNOWLEDGE_DOC_CHARS} is
 * ~1,000 chunks — around 11 batches, well inside one job run.
 *
 * Retrieval quality is the other bound. `match_chunks` returns a handful of
 * chunks per question; a corpus in the millions of characters still ranks fine
 * through the hybrid + rerank path, but there is no point letting a company
 * index a whole newspaper archive against a support widget.
 *
 * The result is a ceiling that a real small business fits comfortably inside —
 * the catalogue and the policy PDF above use about 300,000 of the 5,000,000
 * characters — while still being a number we can defend.
 */

/** Roughly how many characters a dense A4 page of business text holds. Used
 *  only to turn character ceilings into page counts in admin-facing copy. */
export const CHARS_PER_DENSE_PAGE = 3_000;

/**
 * Formats the extractor can read.
 *
 * These live here rather than beside the extractor because the upload form is a
 * client component and needs the `accept` list, while the extractor lazily
 * imports `pdf-parse` and `mammoth` — node-only packages that must never be
 * pulled into a browser bundle. This module imports nothing at all, so it is
 * safe on both sides of the boundary.
 */
export const SUPPORTED_KNOWLEDGE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.csv'] as const;

/** The `accept` attribute for the file input, derived from the list above so
 *  the form and the server cannot disagree about what is allowed. */
export const KNOWLEDGE_UPLOAD_ACCEPT = `${SUPPORTED_KNOWLEDGE_EXTENSIONS.join(',')},text/*,application/pdf`;

// --- Per document ----------------------------------------------------------

/**
 * Characters kept from a single source. ~250 dense pages, ~1,000 chunks,
 * ~11 embedding batches. Deliberately lined up with
 * {@link MAX_KNOWLEDGE_PDF_PAGES} so a long PDF hits both at about the same
 * place rather than being cut by a limit nobody mentioned.
 */
export const MAX_KNOWLEDGE_DOC_CHARS = 750_000;

/**
 * Pages read from a PDF. Was 10, and it REFUSED rather than truncating, so a
 * 60-page policy PDF could not be added at all. Now we read the first 250 and
 * say so on the document row.
 */
export const MAX_KNOWLEDGE_PDF_PAGES = 250;

/**
 * Upload size. Was 5 MB, which was itself unreachable: Next's server actions
 * cap a request body at 1 MB by default and this project sets no
 * `serverActions.bodySizeLimit`, so anything over 1 MB failed in the framework
 * before the action ran and the admin saw a generic error. Uploads now go
 * through `POST /api/company/knowledge/upload`, a route handler, which has no
 * such cap. 25 MB covers a 60-page PDF with scanned page images.
 */
export const MAX_KNOWLEDGE_FILE_BYTES = 25 * 1024 * 1024;

/** Characters accepted from the paste-text box. ~65 dense pages. */
export const MAX_PASTED_TEXT_CHARS = 200_000;

/** Below this we embed inline; above it the work is queued. See
 *  `src/lib/knowledge/ingest-queue.ts`. ~33 chunks, well under a second of
 *  provider time, so short pastes still feel instant. */
export const SYNC_INGEST_CHAR_BUDGET = 25_000;

/** Chunks per embedding request. Matches what the OpenAI and Gemini providers
 *  handle comfortably in one call, and gives progress a useful granularity. */
export const EMBED_BATCH_SIZE = 96;

// --- Per company -----------------------------------------------------------

/**
 * Uploaded files (pdf/docx/txt) a company may hold. Was 3. This is a sanity
 * rail against a scripted bulk upload, not the cost ceiling —
 * {@link MAX_COMPANY_KNOWLEDGE_CHARS} is the cost ceiling.
 */
export const MAX_UPLOADED_KNOWLEDGE_FILES = 50;

/** Total documents of every kind. Crawled pages are one document each now, so
 *  a couple of full site crawls plus files and pasted text has to fit. */
export const MAX_KNOWLEDGE_DOCUMENTS = 400;

/**
 * The real ceiling: total characters indexed for one company. ~6,700 chunks,
 * ~4 cents to embed, a couple of minutes to rebuild. A shop with a 40-page
 * catalogue, a 60-page policy PDF and a 60-page website uses under a fifth of
 * it.
 */
export const MAX_COMPANY_KNOWLEDGE_CHARS = 5_000_000;

// --- Website crawl ---------------------------------------------------------

/**
 * Pages one website import will take. Was 8. 60 covers the whole public site of
 * a small business — every product, service and policy page — and is about
 * 480,000 characters at a typical 8,000 characters of readable text per page.
 */
export const MAX_CRAWL_PAGES = 60;

/**
 * How deep a discovered link may sit below the site root — `/shop/tents/x` is
 * depth 3 — when we are following links because the site publishes no sitemap.
 *
 * The old crawler was effectively depth 1: it read the home page, scraped its
 * hrefs, and stopped, which misses everything a shop keeps two clicks in
 * (category → product, support → article). Three reaches those without the
 * crawl wandering into `/blog/2019/03/some-post` and spending the page budget
 * on an archive. URLs that came from a sitemap are never depth-filtered — the
 * site listed them on purpose.
 */
export const MAX_CRAWL_DEPTH = 3;

/**
 * Characters kept per crawled page. Was 7,000, and every page was then merged
 * into ONE document capped at 50,000 — so page 8 of a crawl routinely
 * contributed nothing at all. Pages are separate documents now, so this is a
 * per-page cap and 40,000 characters is a long page, not a squeeze.
 */
export const MAX_CRAWL_PAGE_CHARS = 40_000;

/**
 * Pages fetched and indexed inside the request that starts the import, before
 * the rest is handed to the queue. Small on purpose: it is enough for the
 * import form to report something true and for the assistant to be usable
 * immediately, and it keeps the action under a normal request budget.
 */
export const SYNC_CRAWL_PAGES = 4;

/** Per-page fetch timeout. A slow shop page should not stall a whole crawl. */
export const CRAWL_FETCH_TIMEOUT_MS = 15_000;

/** Total wall clock a queued crawl job spends before it stops and re-queues
 *  itself. Keeps one big site from monopolising a cron drain. */
export const CRAWL_JOB_BUDGET_MS = 90_000;

/** URLs read out of a sitemap before we stop parsing. Large sites publish
 *  sitemaps with hundreds of thousands of entries; we only need enough to pick
 *  {@link MAX_CRAWL_PAGES} good ones from. */
export const MAX_SITEMAP_URLS_SCANNED = 5_000;

/** Child sitemaps followed from a sitemap index. */
export const MAX_SITEMAP_CHILDREN = 25;

/** Below this a fetched page is treated as having no readable content. */
export const MIN_READABLE_PAGE_CHARS = 100;

// --- Truncation reporting --------------------------------------------------

/**
 * What a source lost, if anything. Every extraction path returns one of these
 * and it is written onto the document row (`truncated`, `truncation_reason`,
 * `page_count`, `pages_ingested`), because a limit the user is not told about
 * is worse than the limit itself: the shop believes the assistant read the
 * whole policy and finds out from a customer that it did not.
 */
export interface TruncationOutcome {
  truncated: boolean;
  /** Admin-facing sentence, e.g. "This PDF has 84 pages and we read the first
   *  60." Null when nothing was dropped. */
  reason: string | null;
  /** Pages the source had, when the source has pages. */
  pageCount: number | null;
  /** Pages actually read. */
  pagesIngested: number | null;
}

export const NO_TRUNCATION: TruncationOutcome = {
  truncated: false,
  reason: null,
  pageCount: null,
  pagesIngested: null,
};

/** Characters as a rough page count, for copy like "about 130 pages". */
export function approximatePages(chars: number): number {
  return Math.max(1, Math.round(chars / CHARS_PER_DENSE_PAGE));
}

/**
 * Cut `text` to `limit` and describe the cut. Every call site that used to be a
 * bare `.slice()` goes through this, so truncation cannot happen without a
 * sentence explaining it.
 */
export function truncateWithNotice(
  text: string,
  limit: number,
  what: string,
): { text: string; outcome: TruncationOutcome } {
  if (text.length <= limit) return { text, outcome: NO_TRUNCATION };
  return {
    text: text.slice(0, limit),
    outcome: {
      truncated: true,
      reason:
        `${what} is about ${approximatePages(text.length).toLocaleString()} pages ` +
        `(${text.length.toLocaleString()} characters) and we indexed the first ` +
        `${approximatePages(limit).toLocaleString()} pages ` +
        `(${limit.toLocaleString()} characters). Split it into smaller documents to index the rest.`,
      pageCount: null,
      pagesIngested: null,
    },
  };
}

/** Human size for admin copy, e.g. "25 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
