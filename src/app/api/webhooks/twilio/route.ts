import { processInboundMessage } from '@/lib/ai/inbound';
import { resolveChannelIdentity } from '@/lib/channels/identity';
import { normalizeWhatsAppNumber } from '@/lib/channels/whatsapp';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Twilio WhatsApp inbound webhook. Twilio posts the customer message as
 * form-urlencoded; we reply with TwiML in the HTTP response, so no send
 * credentials are needed for inbound auto-reply. Map the business number to a
 * company with a channel_identities row (channel='whatsapp', external_id=the
 * business number, settings.provider='twilio').
 *
 * Set the Twilio Sandbox / number "When a message comes in" webhook to:
 *   https://YOUR_APP/api/webhooks/twilio   (HTTP POST)
 */
function twiml(message: string | null): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string,
  );
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return twiml(null);
  }

  const from = normalizeWhatsAppNumber(String(form.get('From') ?? ''));
  const to = normalizeWhatsAppNumber(String(form.get('To') ?? ''));
  const body = String(form.get('Body') ?? '').trim();
  if (!from || !to || !body) return twiml(null);

  try {
    const resolved = await resolveChannelIdentity('whatsapp', to);
    if (!resolved || !resolved.bot || resolved.identity.settings.provider !== 'twilio') {
      logger.warn('Twilio WhatsApp inbound for unmapped/non-twilio number', { to });
      return twiml(null);
    }

    const result = await processInboundMessage({
      bot: resolved.bot,
      visitorId: from,
      text: body,
      channel: 'whatsapp',
    });
    // Reply inline via TwiML; stay silent when a human owns the thread.
    return twiml(result.answer);
  } catch (err) {
    logger.error('Twilio webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return twiml(null);
  }
}
