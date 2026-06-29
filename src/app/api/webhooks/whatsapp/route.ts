import crypto from 'node:crypto';
import { processInboundMessage } from '@/lib/ai/inbound';
import {
  getCustomerBotForCompany,
  resolveWhatsAppRoute,
  sendWhatsAppText,
  type WhatsAppRoute,
} from '@/lib/channels/whatsapp';
import { resolveChannelIdentity } from '@/lib/channels/identity';
import type { BotContext } from '@/lib/ai/engine';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WhatsApp Cloud API webhook.
 *  GET  — Meta verification handshake (hub.challenge).
 *  POST — inbound customer messages → AI reply on the same number.
 * Configure WHATSAPP_VERIFY_TOKEN (and optionally WHATSAPP_APP_SECRET for
 * signature verification) in the environment.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not configured → skip (dev/test)
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    const entries = (payload.entry as Array<Record<string, unknown>>) ?? [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
      for (const change of changes) {
        const value = (change.value as Record<string, unknown>) ?? {};
        const metadata = (value.metadata as Record<string, unknown>) ?? {};
        const phoneNumberId = metadata.phone_number_id as string | undefined;
        const messages = (value.messages as Array<Record<string, unknown>>) ?? [];
        if (!phoneNumberId || messages.length === 0) continue;

        // Prefer the Channels admin mapping (channel_identities); fall back to the
        // legacy notification-settings WhatsApp config for existing setups.
        let route: WhatsAppRoute | null = null;
        let bot: BotContext | null = null;
        const identity = await resolveChannelIdentity('whatsapp', phoneNumberId);
        if (identity?.bot && identity.identity.secret) {
          route = {
            companyId: identity.identity.companyId,
            provider: 'meta_cloud',
            metaToken: identity.identity.secret,
            metaPhoneNumberId: phoneNumberId,
          };
          bot = identity.bot;
        } else {
          route = await resolveWhatsAppRoute(phoneNumberId);
          bot = route ? await getCustomerBotForCompany(route.companyId) : null;
        }
        if (!route || !bot) {
          logger.warn('WhatsApp inbound for unknown phone_number_id', { phoneNumberId });
          continue;
        }

        for (const message of messages) {
          if (message.type !== 'text') continue;
          const from = message.from as string | undefined;
          const text = ((message.text as Record<string, unknown>)?.body as string | undefined)?.trim();
          if (!from || !text) continue;

          const result = await processInboundMessage({
            bot,
            visitorId: from, // the customer's WhatsApp number scopes their conversation
            text,
            channel: 'whatsapp',
          });
          if (result.answer) {
            await sendWhatsAppText(route, from, result.answer);
          }
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still 200 so Meta doesn't hammer retries for a transient app error.
  }

  return new Response('ok', { status: 200 });
}
