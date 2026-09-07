import { randomUUID } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  ATTACHMENT_BUCKET,
  COMPANY_ATTACHMENT_QUOTA_BYTES,
  MAX_ATTACHMENTS_PER_CONVERSATION,
  MAX_ATTACHMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
  attachmentMessageText,
  fileNameExtension,
  formatBytes,
  sanitizeFileName,
  type AttachmentDescriptor,
  type SignedAttachment,
} from '@/lib/attachments/policy';
import { sniffAttachment } from '@/lib/attachments/sniff';

/**
 * Storing and reading chat attachments.
 *
 * This is the ONLY module that touches the bucket. Both callers — the widget's
 * anonymous upload endpoint and the agent composer's authenticated one — have
 * already established which company the request belongs to, and hand that
 * company id in. Everything below filters on it, in the query and in the
 * storage path, because the service-role client bypasses RLS and the filter in
 * code IS the tenant boundary.
 *
 * The object name is `<company_id>/<conversation_id>/<uuid>.<ext>`. The leading
 * company id is not decoration: it is what the `storage.objects` policy in
 * migration 0077 reads, so a path must never be built any other way.
 */

/** Who is sending. Shapes both the message row and the attachment row. */
export type AttachmentUploader =
  | { type: 'visitor'; visitorId: string }
  | { type: 'agent'; userId: string };

export interface StoredAttachment extends SignedAttachment {
  messageId: string;
  conversationId: string;
  createdAt: string;
}

/** One attachment as it comes back out of the database, before signing. */
interface AttachmentRow {
  id: string;
  message_id: string;
  conversation_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  kind: 'image' | 'file';
  created_at: string;
}

const ROW_COLUMNS =
  'id,message_id,conversation_id,storage_path,file_name,mime_type,byte_size,kind,created_at';

/**
 * How many bytes this company already has stored.
 *
 * One aggregate in the database rather than a page of rows over PostgREST —
 * see `public.company_attachment_bytes` in migration 0077, which is granted to
 * `service_role` alone.
 */
async function companyBytesUsed(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  companyId: string,
): Promise<number> {
  const { data, error } = await sb.rpc('company_attachment_bytes', { p_company_id: companyId });
  if (error) {
    // Failing open here would make the quota advisory, and the quota exists to
    // stop one tenant filling the project's storage. Refuse the upload and say
    // why, rather than accepting it and hoping.
    logger.error('Attachment quota lookup failed', { companyId, error: error.message });
    throw new AppError('Attachments are unavailable right now.', 503, 'attachment_quota_unavailable');
  }
  return Number(data ?? 0);
}

/**
 * Accept one file, store it, and post it into the conversation as a message.
 *
 * Validation happens in this order on purpose: the two cheap rejections (size,
 * then type from the bytes) run before anything is written, and the two
 * database round trips (conversation count, company total) run before the
 * object is uploaded, so a rejected upload leaves nothing behind at all.
 */
export async function ingestAttachment(params: {
  companyId: string;
  conversationId: string;
  file: File;
  uploader: AttachmentUploader;
  channel?: string;
  /** Visitor uploads raise the inbox's unread badge; agent uploads do not. */
  bumpUnread?: boolean;
}): Promise<StoredAttachment> {
  const { companyId, conversationId, file, uploader } = params;

  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new AppError('No file was sent.', 400, 'attachment_missing');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AppError(
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      413,
      'attachment_too_large',
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // `file.size` is what the multipart parser measured, but re-check the buffer
  // that was actually read: they are the same number today and the cost of
  // assuming so is an unbounded write.
  if (bytes.byteLength === 0) {
    throw new AppError('That file is empty.', 400, 'attachment_empty');
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AppError(
      `That file is ${formatBytes(bytes.byteLength)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      413,
      'attachment_too_large',
    );
  }

  const sniffed = sniffAttachment(bytes);
  if (!sniffed) {
    throw new AppError(
      'That file type is not accepted. Send an image, a PDF or a plain text file.',
      415,
      'attachment_type_not_allowed',
    );
  }

  const sb = createSupabaseServiceClient();

  // Both caps, in the cheapest order. Neither is a plan feature; they are the
  // difference between a support inbox and free file hosting.
  const { count: existing, error: countErr } = await sb
    .from('message_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId);
  if (countErr) {
    logger.error('Attachment count lookup failed', { companyId, conversationId, error: countErr.message });
    throw new AppError('Attachments are unavailable right now.', 503, 'attachment_store_unavailable');
  }
  if ((existing ?? 0) >= MAX_ATTACHMENTS_PER_CONVERSATION) {
    throw new AppError(
      `This conversation already has ${MAX_ATTACHMENTS_PER_CONVERSATION} attachments.`,
      409,
      'attachment_conversation_limit',
    );
  }

  const used = await companyBytesUsed(sb, companyId);
  if (used + bytes.byteLength > COMPANY_ATTACHMENT_QUOTA_BYTES) {
    throw new AppError(
      `This account has used its ${formatBytes(COMPANY_ATTACHMENT_QUOTA_BYTES)} of attachment storage.`,
      413,
      'attachment_company_quota',
    );
  }

  // The display name keeps whatever extension the sender gave it — a .csv stays
  // a .csv even though it is stored as text/plain — but gains the sniffed one
  // if it had none, so a downloaded file opens in something.
  let fileName = sanitizeFileName(file.name ?? '', sniffed.extension);
  if (!fileNameExtension(fileName)) fileName = `${fileName}.${sniffed.extension}`;

  const attachmentId = randomUUID();
  const storagePath = `${companyId}/${conversationId}/${attachmentId}.${sniffed.extension}`;

  const { error: uploadErr } = await sb.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, Buffer.from(bytes), {
      // The SNIFFED type, never the one the client sent. This header is what a
      // browser acts on when the signed URL is opened.
      contentType: sniffed.mimeType,
      // A fresh uuid cannot collide, so an upsert would only ever hide a bug.
      upsert: false,
      cacheControl: '3600',
    });
  if (uploadErr) {
    logger.error('Attachment upload failed', { companyId, conversationId, error: uploadErr.message });
    throw new AppError('The file could not be uploaded. Try again.', 502, 'attachment_upload_failed');
  }

  const descriptor: AttachmentDescriptor = {
    id: attachmentId,
    name: fileName,
    mimeType: sniffed.mimeType,
    size: bytes.byteLength,
    kind: sniffed.kind,
  };

  // The message carries a copy of the descriptor in `metadata_json` so a reader
  // that already has the message row can render the attachment without a join,
  // and `content_text` is never blank — the widget transcript endpoint drops
  // blank messages, and the inbox preview and search both read that column.
  const { data: messageRow, error: msgErr } = await sb
    .from('messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      channel: params.channel ?? 'web_chat',
      sender_type: uploader.type,
      sender_id: uploader.type === 'agent' ? uploader.userId : uploader.visitorId,
      content_text: attachmentMessageText(sniffed.kind, fileName),
      content_type: sniffed.kind,
      metadata_json: { attachment: descriptor },
    })
    .select('id,created_at')
    .maybeSingle();

  if (msgErr || !messageRow) {
    await removeObjects(sb, [storagePath]);
    logger.error('Attachment message insert failed', {
      companyId,
      conversationId,
      error: msgErr?.message ?? 'no row returned',
    });
    throw new AppError('The file could not be sent. Try again.', 500, 'attachment_message_failed');
  }

  const messageId = messageRow.id as string;

  const { error: rowErr } = await sb.from('message_attachments').insert({
    id: attachmentId,
    company_id: companyId,
    conversation_id: conversationId,
    message_id: messageId,
    storage_bucket: ATTACHMENT_BUCKET,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: sniffed.mimeType,
    byte_size: bytes.byteLength,
    kind: sniffed.kind,
    uploaded_by: uploader.type,
    uploaded_by_user_id: uploader.type === 'agent' ? uploader.userId : null,
    visitor_id: uploader.type === 'visitor' ? uploader.visitorId : null,
  });

  if (rowErr) {
    // Unwind completely rather than leave a message advertising an attachment
    // that nothing can look up, and rather than leave an object that no row
    // counts towards the quota.
    await sb.from('messages').delete().eq('company_id', companyId).eq('id', messageId);
    await removeObjects(sb, [storagePath]);
    logger.error('Attachment row insert failed', { companyId, conversationId, error: rowErr.message });
    throw new AppError('The file could not be sent. Try again.', 500, 'attachment_record_failed');
  }

  if (params.bumpUnread) {
    // Same atomic bump the AI engine uses; a failure here costs a badge, not
    // the message, so it is logged rather than thrown.
    const { error: bumpErr } = await sb.rpc('bump_conversation_unread', {
      p_conversation_id: conversationId,
      p_company_id: companyId,
    });
    if (bumpErr) {
      logger.warn('Unread bump after attachment failed', { companyId, conversationId, error: bumpErr.message });
    }
  }

  const [signed] = await signPaths(sb, [{ ...descriptor, storagePath }]);
  if (!signed) {
    throw new AppError('The file was sent but could not be shown.', 500, 'attachment_sign_failed');
  }

  return {
    ...signed,
    messageId,
    conversationId,
    createdAt: (messageRow.created_at as string) ?? new Date().toISOString(),
  };
}

async function removeObjects(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  paths: string[],
): Promise<void> {
  const { error } = await sb.storage.from(ATTACHMENT_BUCKET).remove(paths);
  if (error) {
    // An orphaned object is a storage bill, not a correctness problem, and the
    // caller is already on a failure path — so record it and move on.
    logger.warn('Could not remove orphaned attachment object', { paths, error: error.message });
  }
}

/**
 * Mint short-lived URLs for a set of already-authorised attachments.
 *
 * One round trip for the whole set. Non-images get `&download=` appended, which
 * is exactly what the Supabase SDK's own `download` option does: it turns the
 * response into `Content-Disposition: attachment`, so a PDF or a text file is
 * saved rather than rendered. Images are the only thing worth showing inline,
 * and they are the only thing shown inline.
 */
async function signPaths(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  items: Array<AttachmentDescriptor & { storagePath: string }>,
): Promise<SignedAttachment[]> {
  if (items.length === 0) return [];
  const { data, error } = await sb.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(items.map((i) => i.storagePath), SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    logger.error('Signing attachment URLs failed', { error: error?.message ?? 'no data' });
    return [];
  }

  const urlByPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  const out: SignedAttachment[] = [];
  for (const item of items) {
    const base = urlByPath.get(item.storagePath);
    if (!base) continue;
    const url =
      item.kind === 'image' ? base : `${base}&download=${encodeURIComponent(item.name)}`;
    out.push({ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size, kind: item.kind, url });
  }
  return out;
}

function toDescriptor(row: AttachmentRow): AttachmentDescriptor & { storagePath: string } {
  return {
    id: row.id,
    name: row.file_name,
    mimeType: row.mime_type,
    size: Number(row.byte_size),
    kind: row.kind,
    storagePath: row.storage_path,
  };
}

/**
 * Every attachment in one conversation, signed, keyed by the message it belongs
 * to. This is what a restored transcript needs: the message rows are already on
 * screen, and each one that carries an attachment needs a URL that was minted
 * just now rather than one that expired an hour ago.
 */
export async function listConversationAttachments(params: {
  companyId: string;
  conversationId: string;
}): Promise<Array<SignedAttachment & { messageId: string; createdAt: string }>> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('message_attachments')
    .select(ROW_COLUMNS)
    .eq('company_id', params.companyId)
    .eq('conversation_id', params.conversationId)
    .order('created_at', { ascending: true })
    .limit(MAX_ATTACHMENTS_PER_CONVERSATION);
  if (error) {
    logger.error('Listing conversation attachments failed', {
      companyId: params.companyId,
      conversationId: params.conversationId,
      error: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as unknown as AttachmentRow[];
  const signed = await signPaths(sb, rows.map(toDescriptor));
  const byId = new Map(signed.map((s) => [s.id, s]));

  const out: Array<SignedAttachment & { messageId: string; createdAt: string }> = [];
  for (const row of rows) {
    const match = byId.get(row.id);
    if (!match) continue;
    out.push({ ...match, messageId: row.message_id, createdAt: row.created_at });
  }
  return out;
}

/**
 * Delete the stored objects for a set of conversations, and say how many went.
 *
 * The rows look after themselves: `message_attachments.conversation_id` cascades,
 * so deleting a conversation takes its attachment rows with it. The FILES do
 * not — nothing in Postgres can reach into the bucket — so a conversation
 * deleted for a data-subject erasure request would leave the customer's
 * photographs sitting in storage with only the row that named them gone. That
 * is the opposite of what an erasure request asks for.
 *
 * Call this BEFORE deleting the conversations: once the rows are gone there is
 * nothing left that knows which objects belonged to them.
 */
export async function purgeConversationAttachments(params: {
  companyId: string;
  conversationIds: string[];
}): Promise<number> {
  if (params.conversationIds.length === 0) return 0;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('message_attachments')
    .select('storage_path')
    .eq('company_id', params.companyId)
    .in('conversation_id', params.conversationIds);
  if (error) {
    logger.error('Could not list attachments to purge', {
      companyId: params.companyId,
      error: error.message,
    });
    return 0;
  }

  const paths = ((data ?? []) as Array<{ storage_path: string }>).map((r) => r.storage_path);
  if (paths.length === 0) return 0;
  await removeObjects(sb, paths);
  return paths.length;
}

/**
 * One attachment, signed, or null.
 *
 * The company id is a filter and not a check-after-the-fact: an id that belongs
 * to another tenant simply does not match, so there is no row to leak and no
 * branch that could forget to compare.
 */
export async function signAttachmentById(params: {
  companyId: string;
  attachmentId: string;
}): Promise<SignedAttachment | null> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('message_attachments')
    .select(ROW_COLUMNS)
    .eq('company_id', params.companyId)
    .eq('id', params.attachmentId)
    .maybeSingle();
  if (error || !data) return null;

  const [signed] = await signPaths(sb, [toDescriptor(data as unknown as AttachmentRow)]);
  return signed ?? null;
}
