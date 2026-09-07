import { z } from 'zod';
import { ApiError, apiData, withApiAuth } from '@/lib/api/handler';
import { unsubscribeRestHook } from '@/lib/api/hooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid('Subscription id must be a UUID.');

/**
 * DELETE /api/v1/hooks/:id — unsubscribe.
 *
 * Zapier calls this when a Zap is turned off or deleted, passing back the id it
 * was given at subscribe time. An id that belongs to another company answers
 * 404, exactly as one that never existed does.
 */
export const DELETE = withApiAuth('conversations:read', async (ctx) => {
  const id = idSchema.parse(ctx.params.id);
  const removed = await unsubscribeRestHook({ companyId: ctx.companyId, id });
  if (!removed) throw new ApiError('not_found', 'Hook subscription not found.');
  return apiData({ id, deleted: true });
});
