import { z } from 'zod';
import { apiData, withApiAuth } from '@/lib/api/handler';
import { assertEventSubscribable, restHookSamples } from '@/lib/api/hooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  event: z.string().min(1, 'event is required').max(80),
  limit: z.coerce.number().int().min(1).max(25).default(3),
});

/**
 * GET /api/v1/hooks/samples?event=… — recent real records for one event.
 *
 * Zapier will not let anyone finish building a Zap without showing them a record
 * from their own account, and a hook that has not fired yet has nothing to show;
 * this is what the app's `performList` calls. The records come back shaped by
 * the same SQL that shapes a real delivery (migration 0079), so the fields a
 * customer maps in the Zap editor are the fields that arrive later.
 *
 * The scope rules are the subscription's: if a key may not subscribe to an
 * event, it may not read that event's records here either.
 */
export const GET = withApiAuth('conversations:read', async (ctx) => {
  const query = querySchema.parse({
    event: ctx.searchParams.get('event') ?? '',
    limit: ctx.searchParams.get('limit') ?? undefined,
  });
  await assertEventSubscribable(ctx.scopes, query.event);
  return apiData(await restHookSamples(ctx.companyId, query.event, query.limit));
});
