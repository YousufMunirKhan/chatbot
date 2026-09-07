import crypto from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { request } from './http';
import { blocksToText } from './types';
import { safeEqual, unverifiedIsAllowed } from './verify';
import type { ChannelAdapter, InboundAttachment, InboundEvent } from './types';
import type { ChannelDescriptor } from './registry';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export const SMS_CHANNEL_KEY = 'sms';
export const SMS_WEBHOOK_PATH = '/api/webhooks/sms';

/**
 * Twilio rejects a message body over 1600 characters outright. Splitting at
 * 1500 keeps a comfortable margin for the trailing whitespace trimming below
 * and still fits inside one concatenated SMS as far as the carrier is
 * concerned, so the customer normally sees a single message.
 */
const MAX_SMS_BODY = 1500;

type TwilioFields = Record<string, string>;

/**
 * Twilio posts `application/x-www-form-urlencoded`, not JSON, so a caller may
 * hand us the raw body, an already-decoded `URLSearchParams`, or a plain object
 * if some route decoded it first. All three are accepted because the adapter
 * contract types the payload as `unknown` and every generic webhook path in
 * this project reaches `parse` having done something slightly different to the
 * body first.
 */
function twilioFields(payload: unknown): TwilioFields | null {
  if (payload instanceof URLSearchParams) {
    return Object.fromEntries(payload.entries());
  }
  if (typeof payload === 'string') {
    return payload.trim() ? Object.fromEntries(new URLSearchParams(payload).entries()) : null;
  }
  if (payload && typeof payload === 'object') {
    const out: TwilioFields = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/**
 * Normalise a phone number to "+digits".
 *
 * Twilio speaks E.164 but a human connecting the channel may paste the number
 * with spaces, brackets or dashes, and the stored `external_id` has to match
 * what the webhook delivers or the identity lookup silently finds nothing.
 */
export function toE164(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  // Already international: keep it.
  if (raw.startsWith('+')) return `+${digits}`;
  // `00` is the international access prefix in most of the world.
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // A leading zero is a NATIONAL trunk prefix, not a country code. Blindly
  // prefixing `+` produced `+07946322081`, which is not a valid E.164 number:
  // nothing after `+` may start with a zero. It showed up in the contact list,
  // and it broke both buttons beside it — a `tel:` link that will not dial and
  // a wa.me link that resolves to nothing. Without knowing the country there is
  // no correct international form, so the national form is kept intact rather
  // than being decorated into something invalid.
  if (digits.startsWith('0')) return digits;
  return `+${digits}`;
}

function mediaKind(contentType: string | undefined): InboundAttachment['kind'] {
  if (contentType?.startsWith('image/')) return 'image';
  if (contentType?.startsWith('video/')) return 'video';
  if (contentType?.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * The URL Twilio signed.
 *
 * Twilio's signature is computed over the webhook URL exactly as it is typed
 * into the console, so a value that differs only by scheme, trailing slash or
 * proxy hostname fails verification while nothing is actually wrong.
 * `TWILIO_SMS_WEBHOOK_URL` is therefore the authoritative answer whenever it is
 * set; behind a proxy the forwarded headers reconstruct what the caller asked
 * for, and the app's own public URL is the last resort for a local run.
 */
export function twilioWebhookUrl(headers: Headers): string {
  const configured = process.env.TWILIO_SMS_WEBHOOK_URL;
  if (configured) return configured;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host) {
    const proto = headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}${SMS_WEBHOOK_PATH}`;
  }
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}${SMS_WEBHOOK_PATH}`;
}

/**
 * Twilio's request signature.
 *
 * The signed string is the full request URL followed by every POST parameter
 * sorted by name and concatenated as name-then-value, hashed with HMAC-SHA1
 * keyed by the account's auth token. Exported separately from the adapter
 * because a route that already has `req.url` can pass the real URL instead of
 * relying on `twilioWebhookUrl` to reconstruct it.
 */
export function verifyTwilioSignature(input: {
  url: string;
  fields: TwilioFields;
  signature: string | null;
  authToken: string | null | undefined;
}): boolean {
  if (!input.authToken) return unverifiedIsAllowed('twilio-sms');
  if (!input.signature) return false;
  const canonical = Object.keys(input.fields)
    .sort()
    .reduce((acc, name) => acc + name + (input.fields[name] ?? ''), input.url);
  const expected = crypto
    .createHmac('sha1', input.authToken)
    .update(Buffer.from(canonical, 'utf8'))
    .digest('base64');
  return safeEqual(expected, input.signature);
}

/**
 * Twilio Programmable SMS.
 *
 * The receiving number arrives in the payload as `To`, so unlike Telegram or
 * Viber the webhook URL does not need to carry the account id. Credentials are
 * split the way Twilio splits them: the auth token is the channel secret (it
 * both signs inbound requests and authenticates outbound ones) while the
 * account SID and any messaging service live in the identity's settings.
 */
export const smsAdapter: ChannelAdapter = {
  key: SMS_CHANNEL_KEY,
  label: 'SMS (Twilio)',
  externalIdHint: 'Your Twilio number in +country format, e.g. +14155550123',

  verifySignature(raw, headers, secret) {
    // An unsigned SMS webhook is worth more to an attacker than most: the
    // forged message reaches the AI and is answered by a real text message that
    // the company pays for. The project-wide rule in ./verify decides.
    if (!secret) return unverifiedIsAllowed('twilio-sms');
    return verifyTwilioSignature({
      url: twilioWebhookUrl(headers),
      fields: twilioFields(raw) ?? {},
      signature: headers.get('x-twilio-signature'),
      authToken: secret,
    });
  },

  parse(payload, ctx): InboundEvent[] {
    const fields = twilioFields(payload);
    if (!fields) return [];

    const externalId = toE164(fields.To) || ctx.queryIdentity || '';
    const from = toE164(fields.From);
    if (!externalId || !from) return [];

    const text = (fields.Body ?? '').trim();
    const attachments: InboundAttachment[] = [];
    const mediaCount = Number.parseInt(fields.NumMedia ?? '0', 10);
    for (let i = 0; i < (Number.isFinite(mediaCount) ? mediaCount : 0); i += 1) {
      const url = fields[`MediaUrl${i}`];
      if (!url) continue;
      attachments.push({ kind: mediaKind(fields[`MediaContentType${i}`]), url });
    }

    // Delivery receipts are posted to the same URL when a company points its
    // status callback here. They carry a MessageStatus but never a body or
    // media, so requiring content is what stops us replying to our own
    // outbound message.
    if (!text && attachments.length === 0) return [];

    return [
      {
        externalId,
        from,
        text,
        messageId: fields.MessageSid || fields.SmsMessageSid || fields.SmsSid || undefined,
        kind: 'message',
        attachments: attachments.length ? attachments : undefined,
        raw: fields,
      },
    ];
  },

  async send(ctx, to, blocks): Promise<boolean> {
    const authToken = ctx.secret ?? process.env.TWILIO_AUTH_TOKEN ?? null;
    const accountSid = settingString(ctx.settings, 'accountSid') || process.env.TWILIO_ACCOUNT_SID || '';
    const messagingServiceSid = settingString(ctx.settings, 'messagingServiceSid');
    const from = settingString(ctx.settings, 'fromNumber') || toE164(ctx.externalId);

    if (!authToken || !accountSid) {
      logger.warn('Twilio SMS send skipped: no account SID or auth token stored', {
        companyId: ctx.companyId,
      });
      return false;
    }
    if (!messagingServiceSid && !from) {
      logger.warn('Twilio SMS send skipped: no sender number or messaging service', {
        companyId: ctx.companyId,
      });
      return false;
    }

    const recipient = toE164(to);
    if (!recipient) {
      logger.warn('Twilio SMS send skipped: recipient is not a phone number', {
        companyId: ctx.companyId,
      });
      return false;
    }

    // SMS has no buttons, galleries or quick replies. Flattening through the
    // shared helper keeps the information — a gallery becomes a numbered list,
    // a button set becomes "1. ... 2. ..." the customer can reply to — instead
    // of dropping every block the transport cannot render natively.
    const body = blocksToText(blocks);
    if (!body) return false;

    const url = `${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`, 'utf8').toString('base64')}`;
    const parts = splitForSms(body);
    let delivered = false;

    for (const [i, part] of parts.entries()) {
      const form = new URLSearchParams({ To: recipient, Body: part });
      if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
      else form.set('From', from);

      const res = await request(url, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });

      if (!res.ok) {
        // Stop at the first failure. Continuing would deliver the tail of an
        // answer whose opening never arrived, which reads worse than a reply
        // that is simply short.
        logger.error('Twilio SMS send failed', {
          companyId: ctx.companyId,
          status: res.status,
          part: i + 1,
          parts: parts.length,
        });
        break;
      }
      delivered = true;
    }

    return delivered;
  },
};

function settingString(settings: Record<string, unknown>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Split a reply into SMS-sized parts.
 *
 * An AI answer that lists products routinely runs past Twilio's limit, and a
 * cut in the middle of a word reads as a bug rather than as a long message, so
 * the break is taken at the last blank line, newline or space in the window.
 * The half-window floor stops a paragraph with no whitespace near the end from
 * producing a stub part.
 */
export function splitForSms(text: string, max = MAX_SMS_BODY): string[] {
  let rest = text.trim();
  if (!rest) return [];
  if (rest.length <= max) return [rest];

  const parts: string[] = [];
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const boundary = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const at = boundary > max / 2 ? boundary : max;
    const part = rest.slice(0, at).trim();
    if (part) parts.push(part);
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * What the Channels screen needs to offer SMS as a connectable channel. It is
 * declared here rather than inline in the registry so the Twilio-specific copy
 * lives beside the Twilio code it describes; the registry just lists it.
 */
export const SMS_CHANNEL_DESCRIPTOR: ChannelDescriptor = {
  key: SMS_CHANNEL_KEY,
  label: 'SMS (Twilio)',
  externalIdHint: 'Your Twilio number in +country format, e.g. +14155550123',
  secretLabel: 'Twilio auth token',
  secretRequired: true,
  identityInUrl: false,
  webhookPath: SMS_WEBHOOK_PATH,
  docsHint: 'Twilio Console → Phone Numbers → Messaging → "A message comes in" → POST this URL.',
};
