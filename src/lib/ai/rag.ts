import { createSupabaseServiceClient } from '@/lib/db/server';
import { getEmbeddingProviderAsync, getRerankProviderAsync } from './providers';
import { logAiUsage } from './usage';
import { logger } from '@/lib/logger';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  text: string;
  similarity: number;
  keywordRank: number;
  score: number;
  language: string | null;
}

/**
 * One retrieved excerpt, named well enough to show a reader.
 *
 * `index` is the same number `formatContext` stamped on the excerpt in the
 * prompt, so `[2]` in an answer and citation 2 in this list are the same piece
 * of text. Every field here is copied off a row we actually retrieved — a
 * citation is never assembled from anything the model said, because a model
 * that invents a source is exactly the failure citations exist to rule out.
 */
export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  title: string;
  sourceType: string;
  url: string | null;
  snippet: string;
  score: number;
}

// Small additive boost for chunks whose language matches the visitor's, so a
// multilingual KB prefers same-language content without hard-excluding fallback.
const LANGUAGE_MATCH_BOOST = 0.06;

// Candidate pool size pulled from the DB before reranking/trimming.
const POOL_SIZE = 24;

// Short-TTL cache of query embeddings so repeated/similar questions skip the
// embedding network call (latency win).
const EMBED_TTL_MS = 5 * 60_000;
const embedCache = new Map<string, { vec: number[]; exp: number }>();
function embedCacheGet(key: string): number[] | null {
  const hit = embedCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.vec;
  if (hit) embedCache.delete(key);
  return null;
}
function embedCacheSet(key: string, vec: number[]): void {
  if (embedCache.size > 500) embedCache.clear();
  embedCache.set(key, { vec, exp: Date.now() + EMBED_TTL_MS });
}
// Drop chunks below this blended/rerank score so weak matches never get
// injected as "knowledge" (Issue #6).
const MIN_BLENDED_SCORE = 0.12;
const MIN_RERANK_SCORE = 0.05;

/**
 * Hybrid retrieval (Module 10, Issues #4/#5/#6/#8):
 *   1. Embed the query and pull a candidate pool that is the UNION of vector
 *      top-N and keyword top-N (the SQL does the union so keyword-only matches
 *      surface even outside the vector neighbourhood).
 *   2. Blend vector similarity + keyword rank. In mock-embedding mode the
 *      vector signal is noise, so keyword rank dominates.
 *   3. Rerank with a cross-encoder when one is configured.
 *   4. Apply a relevance floor and return the top chunks + a context string.
 */
export async function retrieveContext(
  companyId: string,
  botId: string | null,
  query: string,
  topK = 6,
  searchQueries?: string[],
  audience: 'customer' | 'internal' = 'customer',
  language?: string | null,
): Promise<{ chunks: RetrievedChunk[]; contextText: string }> {
  const trimmed = query.trim();
  if (!trimmed) return { chunks: [], contextText: '' };

  // Multi-query retrieval (query rewriting): search with each rewritten query
  // and merge, keeping the best score per chunk. Defaults to the raw query.
  const queries = (searchQueries && searchQueries.length ? searchQueries : [trimmed])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 3);

  const sb = createSupabaseServiceClient();
  const { provider, model, isMock } = await getEmbeddingProviderAsync();

  // Embed only the queries not already in the cache (one batched call).
  const embeddings: number[][] = new Array(queries.length);
  const misses: Array<{ idx: number; q: string }> = [];
  for (let i = 0; i < queries.length; i++) {
    const cached = isMock ? null : embedCacheGet(`${model}\u0000${queries[i]!}`);
    if (cached) embeddings[i] = cached;
    else misses.push({ idx: i, q: queries[i]! });
  }
  if (misses.length > 0) {
    try {
      const { vectors, usage } = await provider.embed(misses.map((m) => m.q), model);
      misses.forEach((m, j) => {
        embeddings[m.idx] = vectors[j]!;
        if (!isMock) embedCacheSet(`${model}\u0000${m.q}`, vectors[j]!);
      });
      if (!isMock) {
        await logAiUsage({
          companyId,
          botId,
          provider: provider.name,
          model,
          operationType: 'embedding',
          inputTokens: usage.inputTokens,
          outputTokens: 0,
        });
      }
    } catch {
      return { chunks: [], contextText: '' };
    }
  }

  // Mock embeddings are meaningless — lean almost entirely on keyword rank.
  const vecWeight = isMock ? 0.1 : 0.7;
  const kwWeight = isMock ? 0.9 : 0.3;

  // Run every query's retrieval in parallel, then merge keeping the best score.
  const perQuery = await Promise.all(
    queries.map((q, i) =>
      sb.rpc('match_chunks', {
        p_company_id: companyId,
        p_bot_id: botId,
        p_query_embedding: JSON.stringify(embeddings[i]),
        p_query_text: q,
        p_match_count: POOL_SIZE,
        p_audience: audience,
      }),
    ),
  );

  const merged = new Map<string, RetrievedChunk>();
  for (const { data, error } of perQuery) {
    if (error || !data) continue;
    for (const d of data as Array<Record<string, unknown>>) {
      const similarity = Number(d.similarity ?? 0);
      const keywordRank = Number(d.keyword_rank ?? 0);
      const chunkLang = (d.language as string) ?? null;
      const langBoost = language && chunkLang && chunkLang === language ? LANGUAGE_MATCH_BOOST : 0;
      const score = vecWeight * similarity + kwWeight * Math.min(1, keywordRank * 10) + langBoost;
      const id = d.id as string;
      const existing = merged.get(id);
      if (!existing || score > existing.score) {
        merged.set(id, {
          id,
          documentId: d.document_id as string,
          text: d.text as string,
          similarity,
          keywordRank,
          score,
          language: chunkLang,
        });
      }
    }
  }

  let candidates = [...merged.values()];
  if (candidates.length === 0) return { chunks: [], contextText: '' };
  candidates.sort((a, b) => b.score - a.score);
  candidates = candidates.slice(0, POOL_SIZE);

  // Cross-encoder rerank when configured (Issue #5).
  const reranker = await getRerankProviderAsync();
  if (reranker && candidates.length > 1) {
    try {
      const ranked = await reranker.provider.rerank(
        trimmed,
        candidates.map((c) => c.text),
        reranker.model,
        topK,
      );
      await logAiUsage({
        companyId,
        botId,
        provider: reranker.provider.name,
        model: reranker.model,
        operationType: 'rerank',
        inputTokens: candidates.reduce((s, c) => s + Math.ceil(c.text.length / 4), 0),
        outputTokens: 0,
      });
      const reranked = ranked
        .map((r) => {
          const base = candidates[r.index];
          return base ? { ...base, score: r.score } : null;
        })
        .filter((c): c is RetrievedChunk => c !== null)
        .filter((c) => c.score >= MIN_RERANK_SCORE);
      if (reranked.length > 0) {
        const chunks = reranked.slice(0, topK);
        return { chunks, contextText: formatContext(chunks) };
      }
    } catch (err) {
      logger.warn('Rerank failed, using blended order', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const chunks = candidates.filter((c) => c.score >= MIN_BLENDED_SCORE).slice(0, topK);
  return { chunks, contextText: formatContext(chunks) };
}

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
}

// Long enough for a reader to recognise the passage the answer came from,
// short enough that the citation list stays a footnote rather than a document.
const SNIPPET_LENGTH = 240;

function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= SNIPPET_LENGTH ? flat : `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…`;
}

/**
 * Name the chunks that were retrieved, so the answer can show its working.
 *
 * Deliberately a separate call rather than part of `retrieveContext`: the
 * numbering costs nothing but the title/URL lookup is two more round trips, and
 * the chat route only needs them once the answer has finished streaming. Kick
 * this off next to retrieval and await it late.
 *
 * The `documents` read is filtered by `company_id` even though the chunks came
 * from a company-scoped RPC. `document_sources` carries no tenant column of its
 * own, so it is reachable only through the ids that survived that filter — a
 * chunk whose document belongs to another company yields no citation at all
 * rather than a titled one.
 */
export async function resolveCitations(
  companyId: string,
  chunks: RetrievedChunk[],
): Promise<Citation[]> {
  if (chunks.length === 0) return [];
  const documentIds = [...new Set(chunks.map((c) => c.documentId))];
  const sb = createSupabaseServiceClient();

  const { data: documentRows, error: documentError } = await sb
    .from('documents')
    .select('id,title,source_type')
    .eq('company_id', companyId)
    .in('id', documentIds);
  if (documentError) {
    logger.warn('Citation lookup failed', { companyId, error: documentError.message });
    return [];
  }

  const documents = new Map<string, { title: string; sourceType: string }>();
  for (const row of (documentRows ?? []) as Array<Record<string, unknown>>) {
    documents.set(row.id as string, {
      title: ((row.title as string) || 'Untitled').trim(),
      sourceType: (row.source_type as string) ?? 'text',
    });
  }
  if (documents.size === 0) return [];

  // Only documents that passed the tenant filter above are looked up here.
  const urls = new Map<string, string>();
  const { data: sourceRows } = await sb
    .from('document_sources')
    .select('document_id,url')
    .in('document_id', [...documents.keys()]);
  for (const row of (sourceRows ?? []) as Array<Record<string, unknown>>) {
    const url = (row.url as string | null)?.trim();
    const documentId = row.document_id as string;
    if (url && !urls.has(documentId)) urls.set(documentId, url);
  }

  const citations: Citation[] = [];
  chunks.forEach((chunk, i) => {
    const document = documents.get(chunk.documentId);
    if (!document) return;
    citations.push({
      index: i + 1,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      title: document.title,
      sourceType: document.sourceType,
      url: urls.get(chunk.documentId) ?? null,
      snippet: snippetOf(chunk.text),
      score: Math.round(chunk.score * 1000) / 1000,
    });
  });
  return citations;
}

/**
 * The citation fields safe to hand a visitor: no chunk id, no retrieval score.
 * Both are internal plumbing, and a relevance number next to a source reads as
 * a confidence claim about the answer, which it is not.
 */
export function publicCitation(citation: Citation): {
  index: number;
  documentId: string;
  title: string;
  sourceType: string;
  url: string | null;
  snippet: string;
} {
  return {
    index: citation.index,
    documentId: citation.documentId,
    title: citation.title,
    sourceType: citation.sourceType,
    url: citation.url,
    snippet: citation.snippet,
  };
}
