import { processInboundMessage } from '@/lib/ai/inbound';
import { resolveChannelIdentity } from '@/lib/channels/identity';
import { sendInstagramText } from '@/lib/channels/instagram';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Instagram / Messenger webhook (Meta Graph). Inbound DMs become conversations
 * and get an AI reply on the same account. Map each IG/page id to a company via
 * a channel_identities row (channel='instagram', external_id=<page id>, secret=
 * page access token). Verify token: INSTAGRAM_VERIFY_TOKEN (or WHATSAPP_VERIFY_TOKEN).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];
    for (const entry of entries) {
      const pageId = entry.id as string | undefined;
      const messaging = (entry.messaging as Array<Record<string, unknown>>) ?? [];
      if (!pageId || messaging.length === 0) continue;

      const resolved = await resolveChannelIdentity('instagram', pageId);
      if (!resolved || !resolved.bot) {
        logger.warn('Instagram inbound for unmapped page', { pageId });
        continue;
      }

      for (const event of messaging) {
        const sender = (event.sender as Record<string, unknown>)?.id as string | undefined;
        const message = event.message as Record<string, unknown> | undefined;
        const text = (message?.text as string | undefined)?.trim();
        // Ignore echoes of our own outbound messages.
        if (!sender || !text || message?.is_echo) continue;

        const result = await processInboundMessage({
          bot: resolved.bot,
          visitorId: sender,
          text,
          channel: 'instagram',
        });
        if (result.answer && resolved.identity.secret) {
          await sendInstagramText(resolved.identity.secret, sender, result.answer);
        }
      }
    }
  } catch (err) {
    logger.error('Instagram webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return new Response('ok', { status: 200 });
}
