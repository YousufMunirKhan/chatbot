import { z } from 'zod';
import { apiData, withApiAuth } from '@/lib/api/handler';
import {
  assertEventSubscribable,
  listRestHooks,
  parseTargetUrl,
  subscribeRestHook,
} from '@/lib/api/hooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * REST hooks — `POST` a target URL to be told when something happens, `DELETE`
 * it to stop. This is the handshake Zapier, Make and n8n all speak, and it is
 * what lets one Zapier app cover HubSpot, Salesforce, Pipedrive, Sheets and
 * everything else those platforms already connect to.
 *
 * ON THE SCOPE THESE ROUTES ASK FOR
 * ---------------------------------
 * `withApiAuth` takes exactly one scope for a whole route, and the scope a hook
 * really costs depends on the event: an order hook is a standing read of orders,
 * an enquiry hook a standing read of contacts. So the route asks for
 * `conversations:read` — the baseline scope any integration with this product
 * holds — and `assertEventSubscribable` enforces the event's own scope per
 * subscription, which is also where the error message can name the scope the
 * caller is actually missing. A dedicated `hooks:*` scope would be tidier and
 * belongs in `src/lib/api-keys.ts`, which this feature does not own.
 */

/** GET /api/v1/hooks — the subscriptions this company holds. */
export const GET = withApiAuth('conversations:read', async (ctx) => {
  return apiData(await listRestHooks(ctx.companyId));
});

const subscribeSchema = z.object({
  event: z.string().min(1, 'event is required').max(80),
  target_url: z.string().min(1, 'target_url is required'),
  /** Shown on Company → Webhooks, so an owner can tell one Zap from another. */
  label: z.string().max(120).optional(),
  /** Which integration platform is subscribing. Audit only. */
  client: z.string().max(40).optional(),
});

/**
 * POST /api/v1/hooks — subscribe a target URL to an event.
 *
 * Idempotent per (event, target URL): Zapier re-subscribes every time a Zap is
 * edited, and a second row would mean the customer's Zap running twice.
 */
export const POST = withApiAuth('conversations:read', async (ctx) => {
  const body = subscribeSchema.parse(await ctx.json());
  const targetUrl = parseTargetUrl(body.target_url);
  await assertEventSubscribable(ctx.scopes, body.event);

  const subscription = await subscribeRestHook({
    companyId: ctx.companyId,
    apiKeyId: ctx.apiKeyId,
    event: body.event,
    targetUrl,
    label: body.label ?? null,
    client: body.client ?? null,
  });

  return apiData(subscription, undefined, 201);
});
