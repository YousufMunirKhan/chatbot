import { handleInboundEvents } from '@/lib/channels/handler';
import { instagramAdapter } from '@/lib/channels/adapters/meta';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Instagram webhook (Meta Graph).
 *
 * Delegates to the shared adapter pipeline, so this endpoint now handles
 * everything the adapter does: direct messages, quick-reply and postback taps,
 * media attachments, ad referrals, and **post comments** — which the previous
 * hand-rolled version silently dropped while the Channels screen offered
 * comment-reply settings for them.
 *
 * The URL is unchanged so an existing Meta app subscription keeps working.
 * Map each account to a company with a `channel_identities` row
 * (channel='instagram', external_id=<IG account id>, secret=page access token).
 * Verify token: INSTAGRAM_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected =
    process.env.INSTAGRAM_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  // The raw bytes are what Meta signed — parsing and re-serialising would
  // change whitespace and break verification.
  const raw = await req.text();

  if (instagramAdapter.verifySignature && !instagramAdapter.verifySignature(raw, req.headers, null)) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    const events = instagramAdapter.parse(payload, { queryIdentity: null, headers: req.headers });
    const result = await handleInboundEvents('instagram', events);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Instagram webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still 200 so Meta does not hammer retries for a transient app error.
    return new Response('ok', { status: 200 });
  }
}
