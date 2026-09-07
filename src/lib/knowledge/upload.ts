import { createSupabaseServiceClient } from '@/lib/db/server';
import { extractUploadedKnowledge } from './extract';
import { ingestKnowledge, knowledgeRoomError } from './ingest-queue';
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_UPLOADED_KNOWLEDGE_FILES,
  MIN_READABLE_PAGE_CHARS,
  formatBytes,
} from './limits';

/**
 * One place that turns an uploaded file into a knowledge document, so the
 * server action and the upload route enforce identical limits and produce
 * identical wording. The callers differ only in how the bytes arrive; every
 * rule below applies to both.
 *
 * Auth is the CALLER's job — both call sites establish the company id from the
 * session before getting here, and `companyId` is never taken from the request.
 */

export interface UploadedKnowledgeInput {
  companyId: string;
  botId: string | null;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface UploadedKnowledgeResult {
  documentId: string;
  title: string;
  queued: boolean;
  /** Non-null when the file was longer than we index. Shown to the admin AND
   *  stored on the document row — see migration 0075. */
  truncationReason: string | null;
  pageCount: number | null;
  pagesIngested: number | null;
}

export async function ingestUploadedFile(
  input: UploadedKnowledgeInput,
): Promise<UploadedKnowledgeResult> {
  if (input.size <= 0) throw new Error('Choose a file to upload.');
  if (input.size > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new Error(
      `That file is ${formatBytes(input.size)}. Uploads are limited to ${formatBytes(MAX_KNOWLEDGE_FILE_BYTES)} — ` +
        'split it, or export it as text.',
    );
  }

  const sb = createSupabaseServiceClient();
  const { count, error: countError } = await sb
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', input.companyId)
    .in('source_type', ['pdf', 'docx', 'txt']);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= MAX_UPLOADED_KNOWLEDGE_FILES) {
    throw new Error(
      `You have ${count} uploaded files, which is the limit of ${MAX_UPLOADED_KNOWLEDGE_FILES}. Delete one you no longer need first.`,
    );
  }

  const extracted = await extractUploadedKnowledge(input.buffer, input.fileName, input.mimeType);
  if (extracted.text.length < MIN_READABLE_PAGE_CHARS) {
    throw new Error(
      'We could not read any text from that file. If it is a scan or a photo, it needs to be a text PDF — ' +
        'run it through OCR first, or paste the content in as text.',
    );
  }

  const full = await knowledgeRoomError(input.companyId, extracted.text.length);
  if (full) throw new Error(full);

  const result = await ingestKnowledge({
    companyId: input.companyId,
    botId: input.botId,
    title: extracted.title,
    text: extracted.text,
    sourceType: extracted.sourceType,
    sourceBytes: input.size,
    truncation: extracted.truncation,
  });

  return {
    documentId: result.documentId,
    title: extracted.title,
    queued: result.queued,
    truncationReason: extracted.truncation.reason,
    pageCount: extracted.truncation.pageCount,
    pagesIngested: extracted.truncation.pagesIngested,
  };
}
