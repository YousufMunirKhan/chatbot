import { createSupabaseServiceClient } from '@/lib/db/server';
import { MAX_COMPANY_KNOWLEDGE_CHARS, MAX_KNOWLEDGE_DOCUMENTS } from './limits';

/**
 * Live ingest status: what is queued, what is indexing, what was shortened, and
 * how far a website crawl has got.
 *
 * This is a read, and reads in this codebase live in
 * `src/modules/<area>/*-data.ts`. It sits here for two reasons that outweigh
 * that. The first is that its only consumer is
 * `src/app/api/company/knowledge/status/route.ts`, which polls it every couple
 * of seconds; `knowledge-data.ts` wraps its readers in React's `cache()`, and a
 * memoised progress reading is a progress bar that never moves. The second is
 * that `scripts/test-query-counts.mjs` loads `knowledge-data.ts` transitively
 * (through `setup-data.ts`) with a hand-written stub list, and every `@/…`
 * import added there has to be stubbed by hand or the whole round-trip budget
 * test stops running — this module's limits import would be exactly that.
 *
 * `companyId` is a parameter rather than something resolved here: the route
 * takes it off the session, and it is never read from the request.
 */

export interface StatusDocument {
  id: string;
  title: string;
  status: string;
  charCount: number;
  sourceUrl: string | null;
  truncated: boolean;
  truncationReason: string | null;
  pageCount: number | null;
  pagesIngested: number | null;
  ingestProgress: number;
  ingestStage: string | null;
}

export interface StatusCrawl {
  id: string;
  rootUrl: string;
  status: string;
  discovery: string;
  pagesDiscovered: number;
  pagesIngested: number;
  pagesFailed: number;
  pagesSkipped: number;
  pageLimit: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface KnowledgeStatus {
  /**
   * Documents that are queued, indexing, failed, or finished with something the
   * admin still needs to be told — a truncation. Everything quiet and complete
   * is left out; the full list is the table on the page.
   */
  documents: StatusDocument[];
  crawls: StatusCrawl[];
  totalDocuments: number;
  totalChars: number;
  charLimit: number;
  documentLimit: number;
  /** True while anything is still moving, so the poller knows to keep polling. */
  busy: boolean;
}

const STATUS_DOCUMENT_COLUMNS =
  'id, title, status, char_count, source_url, truncated, truncation_reason, page_count, pages_ingested, ingest_progress, ingest_stage' as const;

const STATUS_CRAWL_COLUMNS =
  'id, root_url, status, discovery, pages_discovered, pages_ingested, pages_failed, pages_skipped, page_limit, error_message, created_at, finished_at' as const;

export async function getKnowledgeStatus(companyId: string): Promise<KnowledgeStatus> {
  const sb = createSupabaseServiceClient();

  const [documentsResult, crawlsResult, totalsResult] = await Promise.all([
    sb
      .from('documents')
      .select(STATUS_DOCUMENT_COLUMNS)
      .eq('company_id', companyId)
      .or('status.in.(pending,processing,failed),truncated.is.true')
      .order('created_at', { ascending: false })
      .limit(50),
    sb
      .from('knowledge_crawls')
      .select(STATUS_CRAWL_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(5),
    sb
      .from('documents')
      .select('char_count')
      .eq('company_id', companyId)
      .limit(MAX_KNOWLEDGE_DOCUMENTS + 1),
  ]);

  const documents: StatusDocument[] = (documentsResult.data ?? []).map((row) => {
    const d = row as Record<string, unknown>;
    return {
      id: d.id as string,
      title: (d.title as string) ?? 'Untitled',
      status: (d.status as string) ?? 'pending',
      charCount: (d.char_count as number) ?? 0,
      sourceUrl: (d.source_url as string | null) ?? null,
      truncated: Boolean(d.truncated),
      truncationReason: (d.truncation_reason as string | null) ?? null,
      pageCount: (d.page_count as number | null) ?? null,
      pagesIngested: (d.pages_ingested as number | null) ?? null,
      ingestProgress: (d.ingest_progress as number | null) ?? 0,
      ingestStage: (d.ingest_stage as string | null) ?? null,
    };
  });

  const crawls: StatusCrawl[] = (crawlsResult.data ?? []).map((row) => {
    const c = row as Record<string, unknown>;
    return {
      id: c.id as string,
      rootUrl: (c.root_url as string) ?? '',
      status: (c.status as string) ?? 'queued',
      discovery: (c.discovery as string) ?? 'links',
      pagesDiscovered: (c.pages_discovered as number) ?? 0,
      pagesIngested: (c.pages_ingested as number) ?? 0,
      pagesFailed: (c.pages_failed as number) ?? 0,
      pagesSkipped: (c.pages_skipped as number) ?? 0,
      pageLimit: (c.page_limit as number) ?? 0,
      errorMessage: (c.error_message as string | null) ?? null,
      createdAt: c.created_at as string,
      finishedAt: (c.finished_at as string | null) ?? null,
    };
  });

  const totals = (totalsResult.data ?? []) as Array<{ char_count: number | null }>;

  return {
    documents,
    crawls,
    totalDocuments: totals.length,
    totalChars: totals.reduce((sum, row) => sum + (row.char_count ?? 0), 0),
    charLimit: MAX_COMPANY_KNOWLEDGE_CHARS,
    documentLimit: MAX_KNOWLEDGE_DOCUMENTS,
    busy:
      documents.some((doc) => doc.status === 'pending' || doc.status === 'processing') ||
      crawls.some((crawl) => crawl.status === 'queued' || crawl.status === 'running'),
  };
}
