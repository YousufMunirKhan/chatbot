import { ALLOWED_ATTACHMENT_TYPES, type AttachmentKind } from '@/lib/attachments/policy';

/**
 * Decide what an upload actually is by reading its bytes.
 *
 * Neither the filename nor the `Content-Type` the browser attached is evidence
 * of anything. Both are chosen by whoever is uploading: a multipart part can
 * claim `image/png` for a Windows executable, and `.png` on the end of a name
 * costs nothing to type. If the allow-list is checked against either of those,
 * it is not an allow-list, it is a suggestion.
 *
 * So every accepted type here is identified by a signature in the leading bytes,
 * and plain text — which has no signature — is identified by proving the whole
 * buffer decodes as UTF-8 and contains nothing a text file cannot contain.
 */

export interface SniffedType {
  /** The type to store the object as, and to hand back to browsers. */
  mimeType: string;
  kind: AttachmentKind;
  /** Extension for the storage path. Cosmetic; the content type is what counts. */
  extension: string;
  label: string;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]!);
  return out;
}

/**
 * Is this buffer plain text?
 *
 * Three conditions, all of which a genuine .txt or .csv passes and a binary
 * file fails:
 *  - it decodes as UTF-8 with no replacement characters (`TextDecoder` in fatal
 *    mode throws rather than silently substituting);
 *  - it contains no NUL and no C0 control other than tab, newline and carriage
 *    return, which is what separates text from a binary that happens to be
 *    mostly printable;
 *  - it does not begin with `<`.
 *
 * That last one is the interesting one. SVG is refused everywhere else in this
 * module, but an SVG is also perfectly valid UTF-8 text — rename it `.txt` and
 * the first two conditions wave it through. Since a legitimate plain-text
 * attachment essentially never opens with a tag, refusing a leading `<` closes
 * that door and takes HTML with it.
 */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20 || b === 0x7f) return false;
  }
  // Skip a UTF-8 BOM and any leading whitespace before looking at the first
  // real character; Notepad and Excel both write the BOM.
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i += 1;
      continue;
    }
    break;
  }
  return bytes[i] !== 0x3c; // '<'
}

/**
 * Identify an upload, or return null if it is not something we accept.
 *
 * Called with the COMPLETE buffer, not a prefix: the text check has to see
 * every byte, because a file that is a valid PNG for its first kilobyte and a
 * shell script after that is still a shell script.
 */
export function sniffAttachment(bytes: Uint8Array): SniffedType | null {
  const type = identify(bytes);
  if (!type) return null;
  const allowed = ALLOWED_ATTACHMENT_TYPES[type];
  // Belt and braces: `identify` only ever returns types that are on the list,
  // so this catches the list and the sniffer being edited out of step.
  if (!allowed) return null;
  return { mimeType: type, ...allowed };
}

function identify(bytes: Uint8Array): string | null {
  // PNG — the full 8-byte signature, including the CRLF/EOF trap bytes that
  // exist precisely so a corrupted transfer is detectable.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // JPEG — SOI marker followed by any marker byte.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // GIF87a / GIF89a.
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';

  // WebP is a RIFF container: 'RIFF' <4-byte length> 'WEBP'.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';

  // PDF. The header is at offset 0 in the spec, but a stray BOM in front of it
  // is common enough in the wild to be worth allowing, and nothing else.
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(bytes, [0xef, 0xbb, 0xbf]) && ascii(bytes, 3, 5) === '%PDF-') return 'application/pdf';

  if (looksLikeText(bytes)) return 'text/plain';

  return null;
}
