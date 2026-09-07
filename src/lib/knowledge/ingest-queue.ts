import { createSupabaseServiceClient } from '@/lib/db/server';
import { chunkText } from '@/lib/ai/ingest';
import { detectLanguage } from '@/lib/ai/lang';
import { getEmbeddingProviderAsync } from '@/lib/ai/providers';
import { logAiUsage } from '@/lib/ai/usage';
import { logger } from '@/lib/logger';
import {
  CRAWL_JOB_BUDGET_MS,
  EMBED_BATCH_SIZE,
  MAX_COMPANY_KNOWLEDGE_CHARS,
  MAX_CRAWL_PAGES,
  MAX_KNOWLEDGE_DOCUMENTS,
  MIN_READABLE_PAGE_CHARS,
  NO_TRUNCATION,
  SYNC_INGEST_CHAR_BUDGET,
  type TruncationOutcome,
} from './limits';
import { crawlStep, normalizeWebsiteUrl, type CrawlDiscovery } from './crawler';

/**
 * Writing knowledge into the database, and doing the slow half of it on the
 * `background_jobs` queue.
 *
 * WHY THIS IS NOT `src/lib/ai/ingest.ts`
 * --------------------------------------
 * `ingestText` does the whole pipeline inside the caller's request: insert the
 * document, chunk it, embed EVERY chunk in one provider call, insert the chunks,
 * mark it ready. That is fine for a pasted FAQ. It is not fine for a 60-page
 * policy PDF, which is roughly 250 chunks and tens of seconds of provider time,
 * or for a 60-page website crawl, which is minutes. Those requests either time
 * out or hold a connection open behind a spinner that cannot report anything.
 *
 * So this module splits the pipeline in two. The document row is written
 * immediately — the admin sees the file appear, "Waiting to be indexed" — and
 * the embedding runs on the queue, writing real progress onto the row after
 * every batch. Short content still runs inline (see
 * {@link SYNC_INGEST_CHAR_BUDGET}) so pasting a paragraph stays instant.
 *
 * The queue is the existing one: `background_jobs`, drained by `processDueJobs`
 * from `/api/cron?task=jobs` every five minutes. `enqueueKnowledgeJob` inserts
 * the row directly rather than importing `enqueueJob` from `@/lib/jobs`,
 * because `@/lib/jobs` has to import THIS module to execute the job — going the
 * other way as well would make that a cycle.
 *
 * TENANCY
 * -------
 * The service-role client bypasses row-level security, so every statement below
 * carries `company_id` explicitly, including the ones that look like they are
 * already narrowed by a primary key. A document id arriving in a job payload is
 * only ever acted on together with the company id stored beside it.
 */

/** Below this much remaining budget a page is not worth storing as a fragment. */
const MIN_CRAWLED_PAGE_CHARS = MIN_READABLE_PAGE_CHARS;

export const KNOWLEDGE_JOB_INGEST = 'knowledge.ingest';
export const KNOWLEDGE_JOB_CRAWL = 'knowledge.crawl';

/** Job types this module owns, for `@/lib/jobs`'s dispatcher. */
export const KNOWLEDGE_JOB_TYPES = [KNOWLEDGE_JOB_INGEST, KNOWLEDGE_JOB_CRAWL] as const;

export type KnowledgeSourceKind = 'text' | 'url' | 'pdf' | 'docx' | 'txt' | 'faq' | 'csv';

async function enqueueKnowledgeJob(
  companyId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await createSupabaseServiceClient()
    .from('background_jobs')
    .insert({
      company_id: companyId,
      type,
      payload_json: payload,
      run_after: new Date().toISOString(),
      max_attempts: 3,
    });
}

// --- Usage / limits ---------------------------------------------------------

export interface KnowledgeUsage {
  documents: number;
  uploadedFiles: number;
  totalChars: number;
  /** Characters still available before {@link MAX_COMPANY_KNOWLEDGE_CHARS}. */
  charsRemaining: number;
}

/**
 * What this company has already indexed. Read before every add so a limit can
 * be reported as a number the admin can act on ("you have 4.6M of 5M characters
 * indexed") instead of a flat refusal.
 */
export async function getKnowledgeUsage(companyId: string): Promise<KnowledgeUsage> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('documents')
    .select('char_count, source_type')
    .eq('company_id', companyId)
    .limit(MAX_KNOWLEDGE_DOCUMENTS + 1);

  const rows = (data ?? []) as Array<{ char_count: number | null; source_type: string | null }>;
  const totalChars = rows.reduce((sum, row) => sum + (row.char_count ?? 0), 0);
  return {
    documents: rows.length,
    uploadedFiles: rows.filter((row) => ['pdf', 'docx', 'txt'].includes(row.source_type ?? '')).length,
    totalChars,
    charsRemaining: Math.max(0, MAX_COMPANY_KNOWLEDGE_CHARS - totalChars),
  };
}

/**
 * Whether `chars` more characters fit, as a sentence to show the admin, or null
 * when there is room.
 *
 * Shared by every add path so the ceiling is described identically wherever it
 * is hit, and states where the company actually stands — a bare "limit reached"
 * gives nobody anything to do.
 */
export async function knowledgeRoomError(companyId: string, chars: number): Promise<string | null> {
  const usage = await getKnowledgeUsage(companyId);
  if (usage.documents >= MAX_KNOWLEDGE_DOCUMENTS) {
    return `Your knowledge base holds the maximum of ${MAX_KNOWLEDGE_DOCUMENTS.toLocaleString()} documents. Delete something you no longer need first.`;
  }
  if (usage.charsRemaining < chars) {
    return (
      `This would take your knowledge base past its ${MAX_COMPANY_KNOWLEDGE_CHARS.toLocaleString()}-character limit. ` +
      `You have ${usage.totalChars.toLocaleString()} characters indexed and ${usage.charsRemaining.toLocaleString()} left — ` +
      `delete an old document or split this one.`
    );
  }
  return null;
}

// --- Writing a document row -------------------------------------------------

export interface UpsertDocumentInput {
  companyId: string;
  botId: string | null;
  title: string;
  text: string;
  sourceType: KnowledgeSourceKind;
  /** Set for anything imported from the web. Documents sharing a company and a
   *  URL are the SAME document: the unique index in migration 0075 makes a
   *  recrawl update the existing row instead of adding a duplicate. */
  sourceUrl?: string | null;
  crawlId?: string | null;
  sourceBytes?: number | null;
  truncation?: TruncationOutcome;
  audience?: 'customer' | 'internal' | 'both';
}

/**
 * Create — or, when the same company already has this URL, update — the
 * document row and its stored raw text, and leave it queued for embedding.
 *
 * Updating in place matters beyond tidiness: the document id survives a
 * recrawl, so anything already pointing at it keeps pointing at it, and the
 * knowledge page shows one row per page of the site instead of one per import.
 */
export async function upsertKnowledgeDocument(input: UpsertDocumentInput): Promise<{
  documentId: string;
  replaced: boolean;
}> {
  const sb = createSupabaseServiceClient();
  const truncation = input.truncation ?? NO_TRUNCATION;
  const language = detectLanguage(`${input.title}\n${input.text}`);

  const row = {
    company_id: input.companyId,
    bot_id: input.botId,
    title: input.title,
    source_type: input.sourceType,
    audience: input.audience ?? 'customer',
    language,
    status: 'pending',
    char_count: input.text.length,
    source_url: input.sourceUrl ?? null,
    crawl_id: input.crawlId ?? null,
    source_bytes: input.sourceBytes ?? null,
    page_count: truncation.pageCount,
    pages_ingested: truncation.pagesIngested,
    truncated: truncation.truncated,
    truncation_reason: truncation.reason,
    ingest_progress: 0,
    ingest_stage: 'Waiting to be indexed',
  };

  let documentId: string;
  let replaced = false;

  if (input.sourceUrl) {
    // Scoped by company first: a URL only ever collides with the same tenant's
    // own copy of that page.
    const { data: existing } = await sb
      .from('documents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('source_url', input.sourceUrl)
      .maybeSingle();

    if (existing) {
      documentId = (existing as { id: string }).id;
      replaced = true;
      const { error } = await sb
        .from('documents')
        .update(row)
        .eq('id', documentId)
        .eq('company_id', input.companyId);
      if (error) throw new Error(`Could not update document: ${error.message}`);
    } else {
      // The unique index is still the guarantee under concurrency; an insert
      // that loses the race is retried as an update.
      const { data: inserted, error } = await sb.from('documents').insert(row).select('id').single();
      if (error || !inserted) {
        const { data: raced } = await sb
          .from('documents')
          .select('id')
          .eq('company_id', input.companyId)
          .eq('source_url', input.sourceUrl)
          .maybeSingle();
        if (!raced) throw new Error(`Could not create document: ${error?.message ?? 'unknown error'}`);
        documentId = (raced as { id: string }).id;
        replaced = true;
        await sb.from('documents').update(row).eq('id', documentId).eq('company_id', input.companyId);
      } else {
        documentId = (inserted as { id: string }).id;
      }
    }
  } else {
    const { data: inserted, error } = await sb.from('documents').insert(row).select('id').single();
    if (error || !inserted) throw new Error(`Could not create document: ${error?.message ?? 'unknown error'}`);
    documentId = (inserted as { id: string }).id;
  }

  // Chunks and stored source text belong to the document's CURRENT content. On a
  // recrawl the old ones describe a page that no longer exists, so they go.
  if (replaced) {
    await sb.from('chunks').delete().eq('document_id', documentId).eq('company_id', input.companyId);
    await sb.from('document_sources').delete().eq('document_id', documentId);
  }
  await sb.from('document_sources').insert({
    document_id: documentId,
    url: input.sourceUrl ?? null,
    raw_text: input.text,
  });

  return { documentId, replaced };
}

// --- Embedding --------------------------------------------------------------

async function setProgress(
  companyId: string,
  documentId: string,
  progress: number,
  stage: string,
): Promise<void> {
  await createSupabaseServiceClient()
    .from('documents')
    .update({ ingest_progress: Math.max(0, Math.min(100, Math.round(progress))), ingest_stage: stage })
    .eq('id', documentId)
    .eq('company_id', companyId);
}

/**
 * Chunk, embed and store one document's text, reporting progress as it goes.
 *
 * Embedding happens in batches of {@link EMBED_BATCH_SIZE} rather than one call
 * with every chunk, for two reasons: a 1,000-chunk single request is large
 * enough that providers reject or stall it, and a single call can only report
 * "started" and "finished" — which is exactly the spinner this replaces.
 */
export async function embedDocument(companyId: string, documentId: string): Promise<number> {
  const sb = createSupabaseServiceClient();

  const { data: doc } = await sb
    .from('documents')
    .select('id, bot_id, title, audience, language')
    .eq('id', documentId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!doc) throw new Error('Document no longer exists.');

  const d = doc as Record<string, unknown>;
  const botId = (d.bot_id as string | null) ?? null;
  const title = (d.title as string) ?? 'Untitled';
  const audience = ((d.audience as string) ?? 'customer') as 'customer' | 'internal' | 'both';

  const { data: source } = await sb
    .from('document_sources')
    .select('raw_text')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = ((source as { raw_text?: string | null } | null)?.raw_text ?? '').trim();
  if (!text) throw new Error('No stored text to index for this document.');

  const language = (d.language as string | null) ?? detectLanguage(`${title}\n${text}`);

  // Same contextual-retrieval shaping as `ingestText`: the embedded text carries
  // the title and a document-level snippet so a chunk is searchable by what the
  // document is about, not only by the words inside that slice.
  const pieces = chunkText(text);
  if (pieces.length === 0) throw new Error('No text content to ingest.');
  const docContext = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  const contextualPieces = pieces.map((p) => `${title}\n${docContext}\n\n${p}`.trim());

  const { provider, model } = await getEmbeddingProviderAsync();
  const vectors: number[][] = [];
  let inputTokens = 0;

  const batches = Math.ceil(contextualPieces.length / EMBED_BATCH_SIZE);
  for (let batch = 0; batch < batches; batch++) {
    const slice = contextualPieces.slice(batch * EMBED_BATCH_SIZE, (batch + 1) * EMBED_BATCH_SIZE);
    const result = await provider.embed(slice, model);
    vectors.push(...result.vectors);
    inputTokens += result.usage.inputTokens;
    // 5..85% covers embedding; the remaining 15% is the chunk insert below.
    await setProgress(
      companyId,
      documentId,
      5 + ((batch + 1) / batches) * 80,
      `Indexing ${Math.min((batch + 1) * EMBED_BATCH_SIZE, contextualPieces.length)} of ${contextualPieces.length} sections`,
    );
  }

  await logAiUsage({
    companyId,
    botId,
    provider: provider.name,
    model,
    operationType: 'embedding',
    inputTokens,
    outputTokens: 0,
  });

  // Re-indexing replaces; never appends. Without this a recrawl would leave the
  // previous version of the page competing with the new one in retrieval.
  await sb.from('chunks').delete().eq('document_id', documentId).eq('company_id', companyId);

  const rows = pieces.map((p, idx) => ({
    company_id: companyId,
    bot_id: botId,
    document_id: documentId,
    text: p,
    contextual_text: contextualPieces[idx],
    embedding: JSON.stringify(vectors[idx]), // pgvector accepts the '[..]' literal
    audience,
    language,
    metadata_json: { chunk_index: idx },
  }));

  // Inserted in pages, because a single statement carrying 1,000 1536-dimension
  // vectors is several megabytes of JSON and PostgREST rejects it.
  const INSERT_PAGE = 200;
  for (let offset = 0; offset < rows.length; offset += INSERT_PAGE) {
    const { error } = await sb.from('chunks').insert(rows.slice(offset, offset + INSERT_PAGE));
    if (error) throw new Error(error.message);
    await setProgress(
      companyId,
      documentId,
      85 + (Math.min(offset + INSERT_PAGE, rows.length) / rows.length) * 15,
      'Saving sections',
    );
  }

  return rows.length;
}

// --- Running one document ---------------------------------------------------

/**
 * Take a queued document through embedding, moving its status and progress as
 * it goes. Returns false when another worker already claimed it — two pollers
 * and a cron drain can all reach the same row, and the conditional update below
 * is what stops them doing the work twice.
 */
export async function runQueuedDocument(companyId: string, documentId: string): Promise<boolean> {
  const sb = createSupabaseServiceClient();

  const { data: claimed } = await sb
    .from('documents')
    .update({ status: 'processing', ingest_progress: 1, ingest_stage: 'Reading content' })
    .eq('id', documentId)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || claimed.length === 0) return false;

  const { data: job } = await sb
    .from('ingestion_jobs')
    .insert({
      company_id: companyId,
      document_id: documentId,
      status: 'processing',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  try {
    const chunks = await embedDocument(companyId, documentId);
    await sb
      .from('documents')
      .update({
        status: 'ready',
        ingest_progress: 100,
        ingest_stage: null,
        last_ingested_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .eq('company_id', companyId);
    if (job) {
      await sb
        .from('ingestion_jobs')
        .update({ status: 'completed', chunks_created: chunks, finished_at: new Date().toISOString() })
        .eq('id', (job as { id: string }).id);
    }
    logger.info('Ingested document', { companyId, module: 'knowledge' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb
      .from('documents')
      .update({ status: 'failed', ingest_stage: message.slice(0, 300) })
      .eq('id', documentId)
      .eq('company_id', companyId);
    if (job) {
      await sb
        .from('ingestion_jobs')
        .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
        .eq('id', (job as { id: string }).id);
    }
    throw new Error(message);
  }
}

/**
 * The front door for adding knowledge.
 *
 * Small content is embedded before returning, so a pasted paragraph is usable
 * the moment the form comes back. Anything longer is left queued and picked up
 * by the job — which is the whole point: the caller returns in milliseconds and
 * the admin watches a real progress bar instead of holding a request open.
 */
export async function ingestKnowledge(
  input: UpsertDocumentInput,
): Promise<{ documentId: string; queued: boolean; replaced: boolean }> {
  const { documentId, replaced } = await upsertKnowledgeDocument(input);

  if (input.text.length <= SYNC_INGEST_CHAR_BUDGET) {
    await runQueuedDocument(input.companyId, documentId);
    return { documentId, queued: false, replaced };
  }

  await enqueueKnowledgeJob(input.companyId, KNOWLEDGE_JOB_INGEST, {
    companyId: input.companyId,
    documentId,
  });
  return { documentId, queued: true, replaced };
}

// --- Crawl jobs -------------------------------------------------------------

export interface StartCrawlInput {
  companyId: string;
  botId: string | null;
  rootUrl: URL;
  discovery: CrawlDiscovery;
  discovered: number;
  /** URLs left for the queue after the caller ingested its synchronous first
   *  few. */
  pending: string[];
  /** Pages the caller already ingested inline. */
  ingested: number;
  failed: number;
  pageLimit?: number;
}

export async function createCrawlRun(input: StartCrawlInput): Promise<string> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('knowledge_crawls')
    .insert({
      company_id: input.companyId,
      bot_id: input.botId,
      root_url: input.rootUrl.toString(),
      discovery: input.discovery,
      status: input.pending.length > 0 ? 'queued' : 'completed',
      pages_discovered: input.discovered,
      pages_ingested: input.ingested,
      pages_failed: input.failed,
      page_limit: input.pageLimit ?? MAX_CRAWL_PAGES,
      pages_skipped: Math.max(0, input.discovered - (input.pageLimit ?? MAX_CRAWL_PAGES)),
      started_at: new Date().toISOString(),
      finished_at: input.pending.length > 0 ? null : new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not start website import: ${error?.message ?? 'unknown error'}`);
  const crawlId = (data as { id: string }).id;

  if (input.pending.length > 0) {
    await enqueueKnowledgeJob(input.companyId, KNOWLEDGE_JOB_CRAWL, {
      companyId: input.companyId,
      botId: input.botId,
      crawlId,
      rootUrl: input.rootUrl.toString(),
      discovery: input.discovery,
      pending: input.pending,
    });
  }
  return crawlId;
}

interface CrawlJobPayload {
  companyId: string;
  botId: string | null;
  crawlId: string;
  rootUrl: string;
  discovery: CrawlDiscovery;
  pending: string[];
}

function readCrawlPayload(payload: Record<string, unknown>): CrawlJobPayload | null {
  const companyId = payload.companyId;
  const crawlId = payload.crawlId;
  const rootUrl = payload.rootUrl;
  if (typeof companyId !== 'string' || typeof crawlId !== 'string' || typeof rootUrl !== 'string') {
    return null;
  }
  return {
    companyId,
    botId: typeof payload.botId === 'string' ? payload.botId : null,
    crawlId,
    rootUrl,
    discovery: payload.discovery === 'sitemap' ? 'sitemap' : 'links',
    pending: Array.isArray(payload.pending) ? payload.pending.filter((u): u is string => typeof u === 'string') : [],
  };
}

/**
 * Continue a website import on the queue.
 *
 * A run stops at {@link CRAWL_JOB_BUDGET_MS} and re-queues itself with whatever
 * is left, so a large site is crawled across several cron drains rather than
 * holding one of them for ten minutes. Progress is written to the
 * `knowledge_crawls` row after every run, which is what the import panel reads.
 */
export async function runCrawlJob(payload: Record<string, unknown>): Promise<void> {
  const job = readCrawlPayload(payload);
  if (!job) throw new Error('Malformed knowledge.crawl payload.');

  const sb = createSupabaseServiceClient();
  const { data: crawlRow } = await sb
    .from('knowledge_crawls')
    .select('id, pages_ingested, pages_failed, pages_discovered, page_limit')
    .eq('id', job.crawlId)
    .eq('company_id', job.companyId)
    .maybeSingle();
  if (!crawlRow) return; // the company or the crawl was deleted mid-flight

  const crawl = crawlRow as {
    pages_ingested: number;
    pages_failed: number;
    pages_discovered: number;
    page_limit: number;
  };
  const pageLimit = crawl.page_limit || MAX_CRAWL_PAGES;

  await sb
    .from('knowledge_crawls')
    .update({ status: 'running' })
    .eq('id', job.crawlId)
    .eq('company_id', job.companyId);

  // Pages this crawl already turned into documents. Derived rather than carried
  // in the payload so the two cannot disagree after a retry.
  const { data: doneRows } = await sb
    .from('documents')
    .select('source_url')
    .eq('company_id', job.companyId)
    .eq('crawl_id', job.crawlId)
    .limit(pageLimit + 1);
  const seen = (doneRows ?? [])
    .map((row) => (row as { source_url: string | null }).source_url)
    .filter((url): url is string => Boolean(url));

  const root = normalizeWebsiteUrl(job.rootUrl);
  const usage = await getKnowledgeUsage(job.companyId);
  let charBudget = usage.charsRemaining;

  const result = await crawlStep({
    root,
    discovery: job.discovery,
    queue: job.pending,
    seen,
    pageLimit,
    alreadyIngested: crawl.pages_ingested,
    deadline: Date.now() + CRAWL_JOB_BUDGET_MS,
    onPage: async (page) => {
      // Out of room: stop rather than storing a sliver of the page and counting
      // it as read. `crawlStep` puts this URL back on `remaining`.
      if (charBudget < MIN_CRAWLED_PAGE_CHARS) return false;
      const text = page.text.slice(0, charBudget);
      charBudget -= text.length;
      await ingestKnowledge({
        companyId: job.companyId,
        botId: job.botId,
        title: page.title,
        text,
        sourceType: 'url',
        sourceUrl: page.url,
        crawlId: job.crawlId,
        truncation: page.truncation,
      });
      return true;
    },
  });

  const pagesIngested = crawl.pages_ingested + result.ingested;
  const pagesFailed = crawl.pages_failed + result.failed;
  const outOfRoom = charBudget < MIN_CRAWLED_PAGE_CHARS;
  const finished = result.remaining.length === 0 || pagesIngested >= pageLimit || outOfRoom;

  await sb
    .from('knowledge_crawls')
    .update({
      status: finished ? (pagesFailed > 0 ? 'partial' : 'completed') : 'queued',
      pages_ingested: pagesIngested,
      pages_failed: pagesFailed,
      // A link crawl does not know its own size up front, so the discovered
      // count is an estimate that improves every run instead of a number that
      // stays at 1 and makes the progress bar read "12 of 1".
      pages_discovered: Math.max(crawl.pages_discovered, pagesIngested + result.remaining.length),
      pages_skipped: finished ? result.remaining.length + result.skipped : 0,
      finished_at: finished ? new Date().toISOString() : null,
      error_message: outOfRoom
        ? 'Stopped at your knowledge base size limit. Delete something you no longer need and refresh this site to finish it.'
        : null,
    })
    .eq('id', job.crawlId)
    .eq('company_id', job.companyId);

  if (!finished) {
    await enqueueKnowledgeJob(job.companyId, KNOWLEDGE_JOB_CRAWL, { ...job, pending: result.remaining });
  }
}

async function runIngestJob(payload: Record<string, unknown>): Promise<void> {
  const companyId = payload.companyId;
  const documentId = payload.documentId;
  if (typeof companyId !== 'string' || typeof documentId !== 'string') {
    throw new Error('Malformed knowledge.ingest payload.');
  }
  await runQueuedDocument(companyId, documentId);
}

/**
 * Dispatcher for `@/lib/jobs`. One entry point rather than two so the queue's
 * `executeJob` needs a single branch and never has to learn a third knowledge
 * job type.
 *
 * Returns false for a type this module does not own, so the caller can carry on
 * down its own if-chain.
 */
export async function runKnowledgeJob(
  type: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (type === KNOWLEDGE_JOB_INGEST) {
    await runIngestJob(payload);
    return true;
  }
  if (type === KNOWLEDGE_JOB_CRAWL) {
    await runCrawlJob(payload);
    return true;
  }
  return false;
}

// --- Draining one company's queue on demand ---------------------------------

/**
 * Run this company's outstanding knowledge jobs now.
 *
 * The cron drain runs every five minutes, which is the right cadence for a
 * queue and the wrong one for somebody staring at an upload they just made. The
 * knowledge page's status poll calls this, so work starts while the admin is
 * still on the page and the cron drain becomes the safety net rather than the
 * only path.
 *
 * Scoped to the caller's own company, capped per call, and safe to run
 * concurrently with the cron drain: `runQueuedDocument` claims a row with a
 * conditional update and returns false if it lost the race.
 */
export async function drainCompanyKnowledgeJobs(companyId: string, limit = 3): Promise<number> {
  const sb = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: jobs } = await sb
    .from('background_jobs')
    .select('id, type, payload_json, attempts, max_attempts')
    .eq('company_id', companyId)
    .eq('status', 'queued')
    .in('type', [KNOWLEDGE_JOB_INGEST, KNOWLEDGE_JOB_CRAWL])
    .lte('run_after', nowIso)
    .order('created_at', { ascending: true })
    .limit(limit);

  let done = 0;
  for (const raw of (jobs ?? []) as Array<Record<string, unknown>>) {
    const id = raw.id as string;
    const attempts = Number(raw.attempts ?? 0) + 1;
    const maxAttempts = Number(raw.max_attempts ?? 3);

    // Claim it the same way `processDueJobs` does, and only if it is still
    // queued, so the cron drain and this path cannot both run one job.
    const { data: claimed } = await sb
      .from('background_jobs')
      .update({ status: 'running', attempts, locked_at: nowIso })
      .eq('id', id)
      .eq('status', 'queued')
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    try {
      await runKnowledgeJob(raw.type as string, (raw.payload_json as Record<string, unknown>) ?? {});
      await sb
        .from('background_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', id);
      done++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Mirror `processDueJobs`: retry with backoff, dead-letter at the cap.
      if (attempts >= maxAttempts) {
        await sb.from('background_jobs').update({ status: 'dead_letter', last_error: message }).eq('id', id);
        await sb.from('dead_letter_jobs').insert({
          original_job_id: id,
          company_id: companyId,
          type: raw.type,
          payload_json: raw.payload_json ?? {},
          error_message: message,
        });
      } else {
        await sb
          .from('background_jobs')
          .update({
            status: 'queued',
            last_error: message,
            run_after: new Date(Date.now() + attempts * 60_000).toISOString(),
          })
          .eq('id', id);
      }
      logger.warn('Knowledge job failed', { companyId, module: 'knowledge', error: message });
    }
  }

  done += await recoverStrandedDocuments(companyId, limit - done);
  return done;
}

/**
 * Index documents that are still waiting with no job coming for them.
 *
 * A queued document depends on a `background_jobs` row being executed, and a job
 * can stop existing: it dead-letters after `max_attempts`, or the deploy that
 * enqueued it knew a job type the running server does not. Either way the
 * document sits at 'pending' forever, the admin sees "Waiting to be indexed"
 * that never becomes anything, and the assistant silently has no knowledge of a
 * file the shop believes it uploaded.
 *
 * So anything that has been waiting longer than the grace period below is
 * indexed here directly. The grace period keeps this out of the way of the
 * normal path — a job enqueued seconds ago is about to run — and
 * `runQueuedDocument` claims each row conditionally, so this racing the cron
 * drain costs nothing.
 */
const STRANDED_AFTER_MS = 3 * 60_000;

async function recoverStrandedDocuments(companyId: string, limit: number): Promise<number> {
  if (limit <= 0) return 0;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('documents')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - STRANDED_AFTER_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  let done = 0;
  for (const row of (data ?? []) as Array<{ id: string }>) {
    try {
      if (await runQueuedDocument(companyId, row.id)) done++;
    } catch (err) {
      logger.warn('Stranded knowledge document failed to index', {
        companyId,
        module: 'knowledge',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (done > 0) {
    logger.info('Recovered stranded knowledge documents', { companyId, module: 'knowledge' });
  }
  return done;
}
