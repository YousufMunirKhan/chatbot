import {
  MAX_KNOWLEDGE_DOC_CHARS,
  MAX_KNOWLEDGE_PDF_PAGES,
  NO_TRUNCATION,
  truncateWithNotice,
  type TruncationOutcome,
} from './limits';

/**
 * Turning an uploaded file into indexable text, and saying what was lost.
 *
 * This is deliberately free of any database or `next/*` import: it is pure
 * buffer-in, text-out, so it can run inside a server action, inside the queued
 * ingest job, or under a plain node script without dragging a request context
 * along.
 *
 * The behaviour that changed here is the honesty. The old extractor refused a
 * PDF of 11 pages outright, and quietly dropped everything past 20,000
 * characters for every other format. Both now produce a {@link TruncationOutcome}
 * that gets written onto the document row and shown to the admin.
 */

export type KnowledgeSourceType = 'pdf' | 'docx' | 'txt';

export interface ExtractedKnowledge {
  title: string;
  text: string;
  sourceType: KnowledgeSourceType;
  truncation: TruncationOutcome;
}

export function cleanExtractedText(text: string): string {
  return text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Merge a page-level truncation with a character-level one. Both can fire on
 * the same file — a 400-page PDF is cut at 250 pages and then the text of those
 * 250 pages can still exceed the character ceiling — and the admin needs to see
 * both sentences, not whichever happened to be checked last.
 */
function mergeTruncation(a: TruncationOutcome, b: TruncationOutcome): TruncationOutcome {
  if (!a.truncated) return b;
  if (!b.truncated) return a;
  return {
    truncated: true,
    reason: [a.reason, b.reason].filter(Boolean).join(' '),
    pageCount: a.pageCount ?? b.pageCount,
    pagesIngested: a.pagesIngested ?? b.pagesIngested,
  };
}

async function extractPdf(buffer: Buffer, name: string): Promise<ExtractedKnowledge> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const totalPages = typeof info.total === 'number' && info.total > 0 ? info.total : null;
    const pagesToRead =
      totalPages === null ? MAX_KNOWLEDGE_PDF_PAGES : Math.min(totalPages, MAX_KNOWLEDGE_PDF_PAGES);

    // `first: N` parses pages 1..N. Passing it always (rather than only when the
    // document is long) means we never decode 400 pages of a PDF we are going to
    // throw 150 of away — the page cap is now a cost control as well as a limit.
    const parsed = await parser.getText({ first: pagesToRead });

    const pageTruncation: TruncationOutcome =
      totalPages !== null && totalPages > pagesToRead
        ? {
            truncated: true,
            reason:
              `This PDF has ${totalPages.toLocaleString()} pages and we read the first ` +
              `${pagesToRead.toLocaleString()}. Split the rest into a second upload to index it.`,
            pageCount: totalPages,
            pagesIngested: pagesToRead,
          }
        : { ...NO_TRUNCATION, pageCount: totalPages, pagesIngested: totalPages ?? pagesToRead };

    const cleaned = cleanExtractedText(parsed.text);
    const capped = truncateWithNotice(cleaned, MAX_KNOWLEDGE_DOC_CHARS, 'This PDF');

    return {
      title: name.replace(/\.pdf$/i, ''),
      text: capped.text,
      sourceType: 'pdf',
      truncation: mergeTruncation(pageTruncation, capped.outcome),
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer, name: string): Promise<ExtractedKnowledge> {
  const mammoth = await import('mammoth');
  const parsed = await mammoth.extractRawText({ buffer });
  const capped = truncateWithNotice(
    cleanExtractedText(parsed.value),
    MAX_KNOWLEDGE_DOC_CHARS,
    'This document',
  );
  return {
    title: name.replace(/\.docx$/i, ''),
    text: capped.text,
    sourceType: 'docx',
    truncation: capped.outcome,
  };
}

function extractPlainText(buffer: Buffer, name: string): ExtractedKnowledge {
  const capped = truncateWithNotice(
    cleanExtractedText(buffer.toString('utf8')),
    MAX_KNOWLEDGE_DOC_CHARS,
    'This file',
  );
  return {
    title: name.replace(/\.(txt|md|csv)$/i, ''),
    text: capped.text,
    sourceType: 'txt',
    truncation: capped.outcome,
  };
}

/**
 * Read an uploaded file. Throws only when the format is unsupported or the file
 * is unreadable — a file that is merely too long is truncated and reported, not
 * refused, because refusing is what stopped a 60-page policy PDF from reaching
 * the knowledge base at all.
 */
export async function extractUploadedKnowledge(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<ExtractedKnowledge> {
  const name = fileName || 'Uploaded knowledge';
  const lower = name.toLowerCase();

  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    return extractPdf(buffer, name);
  }
  if (
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buffer, name);
  }
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    mimeType.startsWith('text/')
  ) {
    return extractPlainText(buffer, name);
  }

  throw new Error('Upload a PDF, DOCX, TXT, Markdown, or CSV file.');
}
