/**
 * What may be attached to a conversation, and how much of it.
 *
 * This module is deliberately free of server imports — no `@/lib/db/server`, no
 * `next/headers` — because the agent composer is a client component and has to
 * state the same limits to the person before they pick a file. Reaching for the
 * database from here would drag `next/headers` into the browser bundle, which
 * is the same trap the channel adapters are kept out of.
 *
 * Nothing in here is a security boundary on its own. The limits are enforced
 * server-side in `store.ts`, and the type allow-list is enforced against the
 * real bytes in `sniff.ts`. What lives here is the single set of numbers both
 * sides agree on, so the UI cannot promise something the server will reject.
 */

/** The bucket created by migration 0077. Private; read through signed URLs. */
export const ATTACHMENT_BUCKET = 'chat-attachments';

/** 10 MiB. Mirrored as `file_size_limit` on the bucket in migration 0077. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * 1 GiB of stored files per company, across every conversation.
 *
 * A cap has to exist somewhere: without one, a single tenant on the cheapest
 * plan can fill the project's storage and the bill lands on us. A gigabyte is
 * roughly a hundred thousand screenshots, so no honest support team will ever
 * see this — it is a stop on abuse, not a plan feature.
 */
export const COMPANY_ATTACHMENT_QUOTA_BYTES = 1024 * 1024 * 1024;

/**
 * Per conversation, both directions counted together. Stops one visitor turning
 * a single chat into free file hosting without capping a genuine back-and-forth
 * where a customer sends four photos and the agent sends a PDF back.
 */
export const MAX_ATTACHMENTS_PER_CONVERSATION = 20;

/**
 * How long a minted signed URL stays good. Long enough to load a page and read
 * it, short enough that a copied URL is worthless by the time it is pasted
 * anywhere.
 */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export type AttachmentKind = 'image' | 'file';

/**
 * The types a file may actually BE, keyed by the type sniffed from its leading
 * bytes. A client-declared content type never appears in this table.
 *
 * What is missing is as deliberate as what is here:
 *  - `image/svg+xml` is XML that browsers execute. It is the one image type
 *    that can carry script, and it is refused by name as well as by bytes.
 *  - Office formats (.docx, .xlsx) are ZIP containers. Their first four bytes
 *    are identical to a .jar, a .apk and plenty of installers, so "validate the
 *    real bytes" cannot honestly be done for them without unpacking the archive
 *    and inspecting what is inside. Support chats manage on images, PDFs and
 *    plain text; an unverifiable container is not worth the hole.
 *  - Anything executable, obviously.
 */
export const ALLOWED_ATTACHMENT_TYPES: Record<
  string,
  { kind: AttachmentKind; extension: string; label: string }
> = {
  'image/png': { kind: 'image', extension: 'png', label: 'PNG image' },
  'image/jpeg': { kind: 'image', extension: 'jpg', label: 'JPEG image' },
  'image/gif': { kind: 'image', extension: 'gif', label: 'GIF image' },
  'image/webp': { kind: 'image', extension: 'webp', label: 'WebP image' },
  'application/pdf': { kind: 'file', extension: 'pdf', label: 'PDF' },
  'text/plain': { kind: 'file', extension: 'txt', label: 'Plain text' },
};

/**
 * `accept` for a file input. Extensions and media types both, because Safari
 * has historically ignored extension-only lists and Android has historically
 * ignored media-type-only ones. `.csv` is here while `text/csv` is absent from
 * the allow-list above on purpose: a CSV is plain text, so it passes the byte
 * check and is stored as `text/plain` under its own `.csv` name.
 */
export const ATTACHMENT_ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv';

/** Human-readable size. Used in UI copy and in the errors the server returns. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * The one sentence shown wherever a file can be picked. Built from the
 * constants above so it can never disagree with what the server enforces.
 */
export const ATTACHMENT_RULES_TEXT = `Images, PDF or plain text — up to ${formatBytes(
  MAX_ATTACHMENT_BYTES,
)} each.`;

// C0 and C1 control characters, and the Unicode bidi overrides. The overrides
// matter because U+202E in a name visually reverses everything after it, so
// `photo\u202Egnp.exe` reads as `photo.exe.png` in a list of attachments.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_OVERRIDES = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Make a display name safe to store and to print.
 *
 * A name arrives from the sender's machine, so it can contain path separators
 * (`../../etc/passwd`), NUL bytes, the overrides above, or four kilobytes of
 * nothing. None of that reaches the storage path — that is built from a fresh
 * uuid — but it does reach an inbox where somebody reads it, so it is cleaned
 * here.
 */
export function sanitizeFileName(raw: string, fallbackExtension: string): string {
  // Windows and POSIX separators alike: keep only the last segment.
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return `attachment.${fallbackExtension}`;
  return cleaned.length > 120 ? `${cleaned.slice(0, 110)}.${fallbackExtension}` : cleaned;
}

/** The extension a display name ends in, lowercased and without the dot. */
export function fileNameExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1]!.toLowerCase() : '';
}

/**
 * What one stored attachment looks like to anything that renders it. Carries no
 * URL: a signed URL expires, so it is minted at read time and handed over
 * separately rather than cached anywhere.
 */
export interface AttachmentDescriptor {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
}

/** A descriptor plus the short-lived URL that can actually fetch the bytes. */
export interface SignedAttachment extends AttachmentDescriptor {
  url: string;
}

/**
 * Read an attachment descriptor back out of `messages.metadata_json`.
 *
 * The row is written by this codebase, but it is still jsonb: a hand-edited
 * row, a partially-migrated row or a row written by an older build can all be
 * the wrong shape, and a transcript must not blow up because one message has a
 * malformed stamp on it.
 */
export function readAttachmentMetadata(metadata: unknown): AttachmentDescriptor | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).attachment;
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const id = typeof a.id === 'string' ? a.id : null;
  const name = typeof a.name === 'string' ? a.name : null;
  const mimeType = typeof a.mimeType === 'string' ? a.mimeType : null;
  const size = typeof a.size === 'number' ? a.size : null;
  const kind = a.kind === 'image' || a.kind === 'file' ? a.kind : null;
  if (!id || !name || !mimeType || size === null || !kind) return null;
  return { id, name, mimeType, size, kind };
}

/**
 * The line that goes in `messages.content_text` for an attachment.
 *
 * It is never empty, and that is load-bearing rather than cosmetic: the widget's
 * transcript endpoint drops messages whose `content_text` is blank, the inbox
 * list builds its preview from the same column, and search runs an ILIKE over
 * it. A message that exists only as a stored object would otherwise be a hole
 * in every one of those.
 */
export function attachmentMessageText(kind: AttachmentKind, fileName: string): string {
  return kind === 'image' ? `Sent a photo: ${fileName}` : `Sent a file: ${fileName}`;
}
