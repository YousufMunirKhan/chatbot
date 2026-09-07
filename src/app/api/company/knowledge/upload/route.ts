import { NextResponse } from 'next/server';
import { assertRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { AppError, ForbiddenError, RateLimitError, UnauthorizedError, handleApiError } from '@/lib/errors';
import { ingestUploadedFile } from '@/lib/knowledge/upload';
import { MAX_KNOWLEDGE_FILE_BYTES, formatBytes } from '@/lib/knowledge/limits';
import { rateLimitDistributed } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload a knowledge file.
 *
 * WHY THIS IS A ROUTE AND NOT THE SERVER ACTION
 * ---------------------------------------------
 * The upload used to be `addFileSourceAction`, a server action advertising a
 * 5 MB limit it could not honour. Next caps a server action's request body at
 * 1 MB unless `experimental.serverActions.bodySizeLimit` says otherwise, and
 * this project sets no such value — so every file over 1 MB, which is most
 * real PDFs, failed inside the framework before the action ran and surfaced as
 * an unexplained error. A route handler has no equivalent cap, so the limit
 * enforced here is the limit in `src/lib/knowledge/limits.ts` and nothing else.
 *
 * The action is still exported and still works, for small files and anything
 * already wired to it. Both go through `ingestUploadedFile`, so the rules and
 * the wording are the same either way.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw new UnauthorizedError();
    assertRole(user, [ROLES.COMPANY_ADMIN]);
    if (!user.companyId) throw new ForbiddenError('This account is not attached to a company.');
    const companyId = user.companyId;

    const limit = await rateLimitDistributed(`knowledge-upload:${companyId}`, 30, 60_000);
    if (!limit.ok) throw new RateLimitError('Too many uploads at once. Wait a moment and try again.');

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError('Choose a file to upload.', 422, 'validation_error');
    }
    // Checked before the bytes are read into memory as well as inside
    // `ingestUploadedFile`, so an oversized upload is rejected without first
    // buffering 200 MB of it.
    if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
      throw new AppError(
        `That file is ${formatBytes(file.size)}. Uploads are limited to ${formatBytes(MAX_KNOWLEDGE_FILE_BYTES)}.`,
        413,
        'payload_too_large',
      );
    }

    // A bot id from the request body is only ever accepted after proving it
    // belongs to the session's own company; anything else becomes company-wide.
    const botIdInput = form.get('botId');
    let botId: string | null = null;
    if (typeof botIdInput === 'string' && botIdInput) {
      const { data: bot } = await createSupabaseServiceClient()
        .from('bots')
        .select('id')
        .eq('company_id', companyId)
        .eq('id', botIdInput)
        .maybeSingle();
      botId = bot ? ((bot as { id: string }).id) : null;
    }

    const result = await ingestUploadedFile({
      companyId,
      botId,
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });

    return NextResponse.json(result);
  } catch (err) {
    // Extraction and limit failures are messages written for the admin, not
    // internal faults, so they come back as 422 with their own text instead of
    // the generic 500 `handleApiError` would give a bare Error.
    if (err instanceof Error && !(err instanceof AppError)) {
      return NextResponse.json(
        { error: { code: 'upload_failed', message: err.message } },
        { status: 422 },
      );
    }
    return handleApiError(err);
  }
}
