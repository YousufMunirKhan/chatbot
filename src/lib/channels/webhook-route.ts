import { logger } from '@/lib/logger';
import { handleInboundEvents } from './handler';
import { resolveChannelIdentity } from './identity';
import { getChannelAdapter, getChannelDescriptor, isChannelKey } from './registry';
import { toE164 } from './sms';
import type { ChannelKey } from './types';

/**
 * Shared implementation behind every generic channel webhook.
 *
 * `/api/webhooks/[channel]` and the `/api/webhooks/facebook` alias both call in
 * here, so there is exactly one place that verifies a signature, normalises a
 * payload and hands it to `handleInboundEvents`. WhatsApp, Instagram and email
 * keep their own dedicated routes (a static segment wins over the dynamic one
 * in Next), so they are deliberately absent from the list below. SMS has no
 * static segment, so `/api/webhooks/sms` resolves to the dynamic route and is
 * served from here.
 */
export const GENERIC_WEBHOOK_CHANNELS: ChannelKey[] = [
  'telegram',
  'viber',
  'line',
  'facebook',
  'tiktok',
  'youtube',
  'sms',
];

export function isGenericWebhookChannel(value: string): value is ChannelKey {
  return isChannelKey(value) && (GENERIC_WEBHOOK_CHANNELS as string[]).includes(value);
}

/**
 * Channels whose signature is keyed by the *connected account's* own secret
 * (rather than one app-level secret from the environment). For those we have to
 * find the identity row before we can check the signature.
 *
 * SMS belongs here because Twilio signs with the account's auth token, and a
 * platform serving many tenants holds one token per connected number rather
 * than a single one in the environment.
 */
const IDENTITY_SIGNED: ChannelKey[] = ['telegram', 'viber', 'line', 'tiktok', 'sms'];

/**
 * Channels that POST `application/x-www-form-urlencoded` instead of JSON.
 *
 * Twilio posts an SMS as a form body, so `JSON.parse` throws on it and the
 * generic handler below used to answer `ignored: non_json_body` — a silently
 * dropped customer message. Decoding to `URLSearchParams` here keeps the
 * transport detail out of the adapter, which accepts the params object as-is.
 */
const FORM_ENCODED_CHANNELS: ChannelKey[] = ['sms'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The account id we can use to look up the identity *before* the payload is
 * trusted. It only selects which stored secret the signature is checked
 * against — a forged hint still fails verification, so this is safe.
 */
function identityHint(channel: ChannelKey, queryIdentity: string | null, payload: unknown): string | null {
  if (queryIdentity) return queryIdentity;

  if (channel === 'sms') {
    // Twilio names the receiving number `To`. It has to be normalised exactly
    // the way the adapter normalises it, because the identity lookup is a
    // literal string match: a number stored as "+1 415 555 0123" would never
    // find the "+14155550123" Twilio delivers, and the signature check would
    // then run with no secret.
    const to = payload instanceof URLSearchParams ? payload.get('To') : null;
    return toE164(to) || null;
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  if (channel === 'line' && typeof body.destination === 'string') return body.destination;
  if (channel === 'tiktok' && typeof body.user_openid === 'string') return body.user_openid;
  return null;
}

/**
 * GET handshake.
 *
 *  - Meta (`facebook`) verifies with `hub.verify_token`, matched against
 *    META_VERIFY_TOKEN (falling back to WHATSAPP_VERIFY_TOKEN so an existing
 *    deployment keeps working with one token for the whole Meta app).
 *  - YouTube/PubSubHubbub subscribes with `hub.challenge` and no token at all,
 *    so the challenge is echoed for `subscribe`/`unsubscribe` modes.
 *
 * Anything else is 403 — never echo a challenge we cannot attribute.
 */
export async function handleChannelWebhookGet(req: Request, channel: string): Promise<Response> {
  if (!isGenericWebhookChannel(channel)) return new Response('not found', { status: 404 });

  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const challenge = url.searchParams.get('hub.challenge');
  const token = url.searchParams.get('hub.verify_token');

  if (channel === 'facebook') {
    const expected =
      process.env.META_VERIFY_TOKEN ||
      process.env.FACEBOOK_VERIFY_TOKEN ||
      process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) {
      return new Response(challenge ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (channel === 'youtube') {
    // PubSubHubbub: the hub proves the subscription by asking us to echo the
    // challenge. There is no shared token in the protocol.
    if ((mode === 'subscribe' || mode === 'unsubscribe') && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  return new Response('forbidden', { status: 403 });
}

/**
 * POST delivery: verify, parse, dispatch.
 *
 * The raw body is read exactly once — signatures are computed over the exact
 * bytes the provider signed, so re-reading or re-serialising would break them.
 * Application errors answer 200 so providers stop retrying a delivery we can
 * never process; only an unusable signature is rejected (401).
 */
export async function handleChannelWebhookPost(req: Request, channel: string): Promise<Response> {
  if (!isGenericWebhookChannel(channel)) return new Response('not found', { status: 404 });

  const adapter = getChannelAdapter(channel);
  if (!adapter) return new Response('not found', { status: 404 });

  const raw = await req.text();
  const url = new URL(req.url);
  const queryIdentity = url.searchParams.get('id');

  let payload: unknown;
  if ((FORM_ENCODED_CHANNELS as string[]).includes(channel)) {
    // `URLSearchParams` is handed to `parse` rather than a plain object so the
    // adapter can tell a decoded form from a JSON body; the raw string is kept
    // separately for the signature, which is computed over the exact bytes.
    payload = new URLSearchParams(raw);
  } else {
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      // YouTube's push endpoint posts Atom XML, and providers occasionally ping
      // with an empty body. Acknowledge rather than invite an infinite retry.
      logger.warn('Channel webhook body was not JSON', { channel, bytes: raw.length });
      return json({ ok: true, ignored: 'non_json_body' });
    }
  }

  try {
    let secret: string | null = null;
    if (adapter.verifySignature && (IDENTITY_SIGNED as string[]).includes(channel)) {
      const hint = identityHint(channel, queryIdentity, payload);
      if (hint) {
        const resolved = await resolveChannelIdentity(channel, hint);
        secret = resolved?.identity.secret ?? null;
      }
    }

    if (adapter.verifySignature && !adapter.verifySignature(raw, req.headers, secret)) {
      logger.warn('Channel webhook signature rejected', { channel, queryIdentity });
      return new Response('invalid signature', { status: 401 });
    }

    const events = adapter.parse(payload, { queryIdentity, headers: req.headers });
    if (events.length === 0) return json({ ok: true, handled: 0, skipped: 0 });

    const result = await handleInboundEvents(channel, events);
    return json({ ok: true, ...result });
  } catch (err) {
    logger.error('Channel webhook processing failed', {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
    // 200 on purpose: a provider retry cannot fix an application bug.
    return json({ ok: false, error: 'processing_failed' });
  }
}

/** Public webhook URL for a connected account — shown on the Channels screen. */
export function channelWebhookUrl(channel: string, externalId: string, appUrl: string): string {
  const descriptor = getChannelDescriptor(channel);
  const base = `${appUrl.replace(/\/+$/, '')}${descriptor?.webhookPath ?? `/api/webhooks/${channel}`}`;
  return descriptor?.identityInUrl ? `${base}?id=${encodeURIComponent(externalId)}` : base;
}
