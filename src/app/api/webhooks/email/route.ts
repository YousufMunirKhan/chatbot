import { processInboundMessage } from '@/lib/ai/inbound';
import { resolveChannelIdentity } from '@/lib/channels/identity';
import { extractEmail, sendChannelEmail } from '@/lib/channels/email';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound email → conversation webhook. Provider-agnostic: accepts the common
 * JSON / form shapes from Mailgun, SendGrid, Postmark, etc. Map an inbound
 * address to a company with a channel_identities row (channel='email',
 * external_id=<the address>). The AI reply is saved to the conversation and
 * emailed back when an outbound email API is configured (see sendChannelEmail).
 */
async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }
  // Mailgun and others post multipart/form or urlencoded.
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  const out: Record<string, unknown> = {};
  form.forEach((v, k) => {
    out[k] = typeof v === 'string' ? v : '';
  });
  return out;
}

function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export async function POST(req: Request) {
  const body = await parseBody(req);

  const toAddress = extractEmail(pick(body, ['to', 'recipient', 'To', 'envelope_to']));
  const fromAddress = extractEmail(pick(body, ['from', 'sender', 'From', 'envelope_from']));
  const subject = pick(body, ['subject', 'Subject']) ?? '(no subject)';
  const text = pick(body, ['text', 'body-plain', 'TextBody', 'stripped-text', 'plain']);

  if (!toAddress || !fromAddress || !text) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), { status: 400 });
  }

  try {
    const resolved = await resolveChannelIdentity('email', toAddress);
    if (!resolved || !resolved.bot) {
      logger.warn('Inbound email for unmapped address', { toAddress });
      return new Response('ok', { status: 200 });
    }

    const result = await processInboundMessage({
      bot: resolved.bot,
      visitorId: fromAddress, // the sender's address scopes their email thread
      text: subject ? `${subject}\n\n${text}` : text,
      channel: 'email',
    });

    if (result.answer) {
      await sendChannelEmail({
        to: fromAddress,
        from: toAddress,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        text: result.answer,
      });
    }
  } catch (err) {
    logger.error('Email webhook processing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return new Response('ok', { status: 200 });
}
