import { processInboundMessage } from '@/lib/ai/inbound';
import {
  getCustomerBotForCompany,
  resolveWhatsAppRoute,
  sendWhatsAppText,
  type WhatsAppRoute,
} from '@/lib/channels/whatsapp';
import { whatsappAdapter } from '@/lib/channels/adapters/whatsapp';
import { handleInboundEvents } from '@/lib/channels/handler';
import { resolveChannelIdentity } from '@/lib/channels/identity';
import { handleOptKeyword, setOptIn } from '@/lib/channels/subscriptions';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WhatsApp Cloud API webhook.
 *  GET  — Meta verification handshake (hub.challenge).
 *  POST — inbound customer messages → AI reply on the same number.
 *
 * Parsing and delivery run through the shared channel adapter, so this endpoint
 * handles button taps, list selections, media and click-to-WhatsApp ad referrals
 * rather than only plain text, and answers with interactive messages when a flow
 * produces them.
 *
 * The legacy `company_notification_settings` mapping is still honoured for
 * numbers connected before the Channels screen existed — those keep the old
 * text-only behaviour rather than being cut off.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  // The raw bytes are what Meta signed — re-serialising would break the digest.
  const raw = await req.text();

  if (whatsappAdapter.verifySignature && !whatsappAdapter.verifySignature(raw, req.headers, null)) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    const events = whatsappAdapter.parse(payload, { queryIdentity: null, headers: req.headers });
    if (events.length === 0) return Response.json({ ok: true, handled: 0, skipped: 0 });

    // Split by how the number is connected. Anything with a Channels row goes
    // through the shared pipeline (dedupe, consent, flows, rich replies).
    const modern: typeof events = [];
    const legacy: typeof events = [];
    const seen = new Map<string, boolean>();
    for (const event of events) {
      let known = seen.get(event.externalId);
      if (known === undefined) {
        known = Boolean(await resolveChannelIdentity('whatsapp', event.externalId));
        seen.set(event.externalId, known);
      }
      (known ? modern : legacy).push(event);
    }

    let handled = 0;
    let skipped = 0;
    if (modern.length) {
      const result = await handleInboundEvents('whatsapp', modern);
      handled += result.handled;
      skipped += result.skipped;
    }
    for (const event of legacy) {
      const ok = await handleLegacyNumber(event.externalId, event.from, event.text);
      if (ok) handled += 1;
      else skipped += 1;
    }
    return Response.json({ ok: true, handled, skipped });
  } catch (err) {
    logger.error('WhatsApp webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still 200 so Meta doesn't hammer retries for a transient app error.
    return new Response('ok', { status: 200 });
  }
}

/**
 * Numbers configured through the old notification settings, before
 * `channel_identities` existed. Text only, exactly as before — the point is to
 * keep those installs working, not to grow a second pipeline.
 */
async function handleLegacyNumber(phoneNumberId: string, from: string, text: string): Promise<boolean> {
  const route: WhatsAppRoute | null = await resolveWhatsAppRoute(phoneNumberId);
  if (!route) {
    logger.warn('WhatsApp inbound for unknown phone_number_id', { phoneNumberId });
    return false;
  }
  const bot = await getCustomerBotForCompany(route.companyId);
  if (!bot || !text) return false;

  // STOP / اشتراك is honoured on the message it arrives in — a WhatsApp Business
  // Policy requirement, and the reason a number gets blocked.
  const optAction = handleOptKeyword(text);
  if (optAction) {
    await setOptIn(route.companyId, 'whatsapp', from, optAction === 'opt_in', 'keyword');
    await sendWhatsAppText(
      route,
      from,
      optAction === 'opt_out'
        ? 'You have been unsubscribed and will not receive further marketing messages. Reply START to opt back in.'
        : 'You are subscribed again and will receive our updates. Reply STOP at any time to unsubscribe.',
    );
    return true;
  }

  const result = await processInboundMessage({
    bot,
    visitorId: from, // the customer's WhatsApp number scopes their conversation
    text,
    channel: 'whatsapp',
  });
  if (result.answer) await sendWhatsAppText(route, from, result.answer);
  return true;
}
