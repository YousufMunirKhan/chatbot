import { createSupabaseServiceClient } from '@/lib/db/server';
import { getEmbeddingProviderAsync } from './providers';
import { logAiUsage } from './usage';
import { logger } from '@/lib/logger';

/** Split text into overlapping chunks for embedding (Module 10 pipeline). */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size).trim());
    if (i + size >= clean.length) break;
    i += size - overlap;
  }
  return chunks.filter(Boolean);
}

export interface IngestInput {
  companyId: string;
  botId: string | null;
  title: string;
  text: string;
  sourceType?: 'text' | 'url' | 'pdf' | 'docx' | 'txt' | 'faq' | 'csv';
}

/**
 * Ingest raw text into the knowledge base: document → chunks → embeddings →
 * store (with tsvector auto-generated). Returns the document id + chunk count.
 */
export async function ingestText(input: IngestInput): Promise<{ documentId: string; chunks: number }> {
  const sb = createSupabaseServiceClient();
  const { companyId, botId, title } = input;

  const { data: doc, error: docErr } = await sb
    .from('documents')
    .insert({
      company_id: companyId,
      bot_id: botId,
      title,
      source_type: input.sourceType ?? 'text',
      status: 'processing',
      char_count: input.text.length,
    })
    .select('id')
    .single();
  if (docErr || !doc) throw new Error('Could not create document: ' + docErr?.message);

  const { data: job } = await sb
    .from('ingestion_jobs')
    .insert({ company_id: companyId, document_id: doc.id, status: 'processing', started_at: new Date().toISOString() })
    .select('id')
    .single();
  await sb.from('document_sources').insert({ document_id: doc.id, raw_text: input.text });

  try {
    const pieces = chunkText(input.text);
    if (pieces.length === 0) throw new Error('No text content to ingest.');

    // Lightweight contextual retrieval (Issue #7): prepend the document title and
    // a short document-level context to each chunk, then embed the CONTEXTUAL
    // text (not the bare chunk) so both vector and keyword search carry the
    // surrounding context. Deterministic — no per-chunk LLM call.
    const docContext = input.text.replace(/\s+/g, ' ').trim().slice(0, 240);
    const contextualPieces = pieces.map((p) => `${title}\n${docContext}\n\n${p}`.trim());

    const { provider, model } = await getEmbeddingProviderAsync();
    const { vectors, usage } = await provider.embed(contextualPieces, model);
    await logAiUsage({
      companyId,
      botId,
      provider: provider.name,
      model,
      operationType: 'embedding',
      inputTokens: usage.inputTokens,
      outputTokens: 0,
    });

    const rows = pieces.map((p, idx) => ({
      company_id: companyId,
      bot_id: botId,
      document_id: doc.id,
      text: p,
      contextual_text: contextualPieces[idx],
      embedding: JSON.stringify(vectors[idx]), // pgvector accepts the '[..]' literal
      metadata_json: { chunk_index: idx },
    }));

    const { error: insErr } = await sb.from('chunks').insert(rows);
    if (insErr) throw insErr;

    await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
    if (job) {
      await sb
        .from('ingestion_jobs')
        .update({ status: 'completed', chunks_created: rows.length, finished_at: new Date().toISOString() })
        .eq('id', job.id);
    }
    logger.info('Ingested document', { companyId, module: 'knowledge' });
    return { documentId: doc.id, chunks: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from('documents').update({ status: 'failed' }).eq('id', doc.id);
    if (job) {
      await sb
        .from('ingestion_jobs')
        .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
        .eq('id', job.id);
    }
    throw new Error(message);
  }
}
