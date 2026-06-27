import type { RerankProvider } from '@/lib/ai/types';
import { fetchWithRetry } from '@/lib/ai/http';

/**
 * Reranker adapters (Issue #5). Cohere and Voyage both expose a multilingual
 * cross-encoder rerank endpoint — critical for Arabic + English retrieval
 * quality (Module 10/21). Selected from settings by `getRerankProviderAsync()`.
 */

/** Cohere rerank (default model: rerank-multilingual-v3.0). */
export function createCohereReranker(apiKey: string): RerankProvider {
  return {
    name: 'cohere',
    async rerank(query, documents, model, topK) {
      if (documents.length === 0) return [];
      const res = await fetchWithRetry('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'rerank-multilingual-v3.0',
          query,
          documents,
          top_n: topK ?? documents.length,
        }),
      });
      if (!res.ok) throw new Error(`Cohere rerank error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return (json.results ?? []).map((r: { index: number; relevance_score: number }) => ({
        index: r.index,
        score: r.relevance_score,
      }));
    },
  };
}

/** Voyage rerank (default model: rerank-2). */
export function createVoyageReranker(apiKey: string): RerankProvider {
  return {
    name: 'voyage',
    async rerank(query, documents, model, topK) {
      if (documents.length === 0) return [];
      const res = await fetchWithRetry('https://api.voyageai.com/v1/rerank', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'rerank-2',
          query,
          documents,
          top_k: topK ?? documents.length,
        }),
      });
      if (!res.ok) throw new Error(`Voyage rerank error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return (json.data ?? []).map((r: { index: number; relevance_score: number }) => ({
        index: r.index,
        score: r.relevance_score,
      }));
    },
  };
}
