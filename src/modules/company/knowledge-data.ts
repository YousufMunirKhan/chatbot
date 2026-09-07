import { cache } from 'react';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId, listBots } from './data';

/**
 * Knowledge-base data layer (Module 10). Every query is scoped to the SESSION
 * user's own `companyId` (via getCompanyId) so a company admin can only ever see
 * their own documents.
 */
/**
 * A live policy/FAQ that owns a generated document. `business-profile-actions`
 * ingests a document for every policy and FAQ and stores its id on the row, so
 * these documents are not free-standing knowledge — deleting one silently
 * removes the RAG coverage for a policy/FAQ that stays visible in the UI
 * (Issue #15).
 */
export interface DocumentReference {
  kind: 'policy' | 'faq';
  label: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  charCount: number;
  botName: string | null;
  createdAt: string;
  /** Set when a live policy/FAQ generated (and still owns) this document. */
  generatedFrom: DocumentReference | null;
  /** The page this document was imported from, when it came from the web. */
  sourceUrl: string | null;
  /**
   * True when the source was longer than we index. The row is otherwise
   * indistinguishable from a complete one, which is exactly how a shop ended up
   * believing the assistant had read all 84 pages of its policy PDF.
   */
  truncated: boolean;
  /** Admin-facing sentence explaining what was left out. */
  truncationReason: string | null;
  pageCount: number | null;
  pagesIngested: number | null;
  /** 0-100 while indexing, written by the queued job after each batch. */
  ingestProgress: number;
  /** What the job is doing right now, or the failure message when it failed. */
  ingestStage: string | null;
}

/**
 * Which of `documentIds` are still referenced by a live policy or FAQ of this
 * company. Shared by `listDocuments` (to flag generated documents) and
 * `deleteDocumentAction` (to refuse a delete that would orphan one).
 */
export async function findDocumentReferences(
  companyId: string,
  documentIds: string[],
): Promise<Map<string, DocumentReference>> {
  const refs = new Map<string, DocumentReference>();
  if (documentIds.length === 0) return refs;

  const sb = createSupabaseServiceClient();
  const [policies, faqs] = await Promise.all([
    sb
      .from('company_policies')
      .select('title, document_id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .in('document_id', documentIds),
    sb
      .from('company_faqs')
      .select('question, document_id')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .in('document_id', documentIds),
  ]);

  for (const row of policies.data ?? []) {
    const x = row as Record<string, unknown>;
    const documentId = x.document_id as string | null;
    if (documentId) refs.set(documentId, { kind: 'policy', label: String(x.title ?? 'Untitled policy') });
  }
  for (const row of faqs.data ?? []) {
    const x = row as Record<string, unknown>;
    const documentId = x.document_id as string | null;
    // A policy reference already blocks the delete; do not overwrite it.
    if (documentId && !refs.has(documentId)) {
      refs.set(documentId, { kind: 'faq', label: String(x.question ?? 'Untitled FAQ') });
    }
  }
  return refs;
}

function toDocumentRow(
  raw: Record<string, unknown>,
  botNames: Map<string, string>,
  references: Map<string, DocumentReference>,
): DocumentRow {
  const botId = (raw.bot_id as string) ?? null;
  const id = raw.id as string;
  return {
    id,
    title: raw.title as string,
    sourceType: raw.source_type as string,
    status: raw.status as string,
    charCount: (raw.char_count as number) ?? 0,
    botName: botId ? botNames.get(botId) ?? null : null,
    createdAt: raw.created_at as string,
    generatedFrom: references.get(id) ?? null,
    sourceUrl: (raw.source_url as string | null) ?? null,
    truncated: Boolean(raw.truncated),
    truncationReason: (raw.truncation_reason as string | null) ?? null,
    pageCount: (raw.page_count as number | null) ?? null,
    pagesIngested: (raw.pages_ingested as number | null) ?? null,
    ingestProgress: (raw.ingest_progress as number | null) ?? 0,
    ingestStage: (raw.ingest_stage as string | null) ?? null,
  };
}

// One literal, not a concatenation: `@supabase/supabase-js` parses the select
// string at the TYPE level, and a `string` (which is what `'a' + 'b'` widens to)
// makes every row come back as `GenericStringError` instead of a record.
const DOCUMENT_COLUMNS =
  'id, title, source_type, status, char_count, bot_id, created_at, source_url, truncated, truncation_reason, page_count, pages_ingested, ingest_progress, ingest_stage' as const;

/**
 * `cache()`d, and the bot lookup no longer waits for the document list: the two
 * are independent, and a sequential `await` costs a full round trip (~230 ms on
 * this deployment) for nothing. The home page's setup checklist and the
 * knowledge page both call this within one render.
 */
export const listDocuments = cache(async function listDocuments(): Promise<DocumentRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  // Bots resolve `bot_id` -> name and do not depend on the document rows.
  const [{ data, error }, bots] = await Promise.all([
    sb
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }),
    listBots(),
  ]);
  if (error) throw error;

  const botNames = new Map<string, string>(bots.map((b) => [b.id, b.name]));
  const references = await findDocumentReferences(
    companyId,
    (data ?? []).map((d) => (d as Record<string, unknown>).id as string),
  );

  return (data ?? []).map((d) => toDocumentRow(d as Record<string, unknown>, botNames, references));
});
