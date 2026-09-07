import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import type { BotContext } from '@/lib/ai/engine';
import { loadBotByPublicId } from '@/lib/ai/engine';
import { logger } from '@/lib/logger';
import {
  evaluateServiceWindow,
  serviceWindowRefusalReason,
  toInstant,
  type ServiceWindow,
} from './whatsapp-window';

export interface WhatsAppRoute {
  companyId: string;
  provider: 'meta_cloud' | 'twilio';
  metaToken: string | null;
  metaPhoneNumberId: string | null;
}

/** Normalise a WhatsApp number to "+<digits>" (strips "whatsapp:" + spacing). */
export function normalizeWhatsAppNumber(value: string | null | undefined): string {
  const raw = String(value ?? '').replace(/^whatsapp:/i, '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

/**
 * Resolve which company owns the WhatsApp business number that received an
 * inbound message (Meta includes phone_number_id in the webhook). Reads the
 * company's stored credentials so we can reply on the same number.
 */
export async function resolveWhatsAppRoute(phoneNumberId: string): Promise<WhatsAppRoute | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_notification_settings')
    .select('company_id,whatsapp_provider,meta_phone_number_id,meta_access_token_encrypted')
    .eq('meta_phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const provider = row.whatsapp_provider === 'twilio' ? 'twilio' : 'meta_cloud';
  let metaToken: string | null = null;
  try {
    const enc = row.meta_access_token_encrypted as string | null;
    metaToken = enc ? decryptSecret(enc) : null;
  } catch {
    metaToken = null;
  }
  return {
    companyId: row.company_id as string,
    provider,
    metaToken,
    metaPhoneNumberId: (row.meta_phone_number_id as string) ?? null,
  };
}

/** Pick the company's customer-facing bot to answer inbound channel messages. */
export async function getCustomerBotForCompany(companyId: string): Promise<BotContext | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select('public_bot_id, appearance_json, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .limit(50);
  const rows = (data ?? []) as Array<{ public_bot_id: string; appearance_json: Record<string, unknown> | null }>;
  // Prefer an explicitly customer-facing bot; fall back to the first one.
  const customer =
    rows.find((r) => (r.appearance_json?.assistantAudience ?? 'customer') !== 'internal') ?? rows[0];
  if (!customer) return null;
  return loadBotByPublicId(customer.public_bot_id);
}

/**
 * Every spelling of one WhatsApp number we might have on file.
 *
 * Meta's webhook carries a bare `wa_id` ("923001234567") and that is what the
 * inbound pipeline saves as `messages.sender_id`, while broadcasts and the
 * consent ledger hold the normalised "+923001234567". A window lookup matching
 * only one of the two would report "never messaged us" for a customer who is
 * halfway through a conversation, and refuse the reply.
 */
function numberVariants(value: string): string[] {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) return [];
  return [normalized, normalized.slice(1)];
}

/**
 * Where the 24h service window stands for one contact of one company.
 *
 * Two signals, read in parallel because a round trip to this database costs far
 * more than either query does (see migration 0062). The first is the customer's
 * last saved inbound message. The second is a consent row that this contact's
 * own STOP/START keyword wrote: the opt-keyword branch of the webhook answers
 * before the message reaches `messages`, and refusing the unsubscribe
 * confirmation that WhatsApp's Business Policy requires would be a worse
 * failure than the violation this check exists to prevent.
 */
export async function getWhatsAppServiceWindow(
  companyId: string,
  contact: string,
  now: Date = new Date(),
): Promise<ServiceWindow> {
  const variants = numberVariants(contact);
  if (!companyId || variants.length === 0) return evaluateServiceWindow(null, now);

  const sb = createSupabaseServiceClient();
  const [inbound, consent] = await Promise.all([
    sb
      .from('messages')
      .select('created_at')
      // TENANT ISOLATION: the service client bypasses RLS, so this filter is the
      // security boundary — one company must never read another's window.
      .eq('company_id', companyId)
      .eq('channel', 'whatsapp')
      .eq('sender_type', 'visitor')
      .in('sender_id', variants)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from('contact_subscriptions')
      .select('updated_at')
      .eq('company_id', companyId)
      .eq('channel', 'whatsapp')
      .eq('source', 'keyword')
      .in('contact_identifier', variants)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const seen = [
    toInstant((inbound.data as { created_at?: string } | null)?.created_at),
    toInstant((consent.data as { updated_at?: string } | null)?.updated_at),
  ];
  const lastInbound = seen.reduce<Date | null>(
    (latest, at) => (at && (!latest || at > latest) ? at : latest),
    null,
  );
  return evaluateServiceWindow(lastInbound, now);
}

export interface WhatsAppTextOptions {
  /**
   * The customer's last inbound instant when the caller already knows it. A
   * webhook answering the message it is still holding should pass `new Date()`
   * rather than pay a lookup for the row it just wrote.
   */
  lastInboundAt?: Date | string | null;
  /** Injectable clock, so the refusal path can be tested without waiting a day. */
  now?: Date;
}

export type WhatsAppSendOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'outside_service_window' | 'send_failed'; detail: string };

/**
 * Send a free-form WhatsApp text, refusing it when the 24h customer service
 * window has closed.
 *
 * Meta rejects such a send anyway; the difference is that a local refusal costs
 * nothing, whereas a rejected send is counted against the number's quality
 * rating. The refusal is returned and logged rather than swallowed, so an
 * operator can see that a message did not go out and why — a message that
 * disappears silently is how a customer ends up waiting for an answer nobody
 * knows was never sent. Sending a template instead is deliberately not
 * attempted here: that needs a template approved in the company's own Meta
 * console, which `sendWhatsAppTemplate` handles once one exists.
 */
export async function sendWhatsAppTextResult(
  route: WhatsAppRoute,
  to: string,
  text: string,
  options: WhatsAppTextOptions = {},
): Promise<WhatsAppSendOutcome> {
  if (route.provider !== 'meta_cloud' || !route.metaToken || !route.metaPhoneNumberId) {
    logger.warn('WhatsApp reply skipped: provider not configured for inbound text', { companyId: route.companyId });
    return { ok: false, reason: 'not_configured', detail: 'WhatsApp provider is not configured for this company.' };
  }

  const now = options.now ?? new Date();
  const serviceWindow = options.lastInboundAt
    ? evaluateServiceWindow(options.lastInboundAt, now)
    : await getWhatsAppServiceWindow(route.companyId, to, now);
  const refusal = serviceWindowRefusalReason(serviceWindow);
  if (refusal) {
    logger.warn('WhatsApp free-form send refused: 24h service window closed', {
      companyId: route.companyId,
      module: 'channels/whatsapp',
      // The number is the customer's personal data, so only the last four
      // digits go to the log drain — enough to match against the inbox.
      contact: `…${normalizeWhatsAppNumber(to).slice(-4)}`,
      windowExpiredAt: serviceWindow.expiresAt ? serviceWindow.expiresAt.toISOString() : null,
      reason: refusal,
    });
    return { ok: false, reason: 'outside_service_window', detail: refusal };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${route.metaPhoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.metaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/^whatsapp:/, ''),
        type: 'text',
        text: { preview_url: false, body: text.slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      logger.error('Meta WhatsApp text send failed', { status: res.status, companyId: route.companyId });
      return { ok: false, reason: 'send_failed', detail: `Meta rejected the send with HTTP ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Meta WhatsApp text send threw', { error: message, companyId: route.companyId });
    return { ok: false, reason: 'send_failed', detail: `Could not reach Meta: ${message}` };
  }
}

/**
 * Boolean form of {@link sendWhatsAppTextResult}, kept because every existing
 * caller counts sends and failures rather than reading a reason. New callers
 * should prefer the result form and surface `detail` to the operator.
 */
export async function sendWhatsAppText(
  route: WhatsAppRoute,
  to: string,
  text: string,
  options: WhatsAppTextOptions = {},
): Promise<boolean> {
  const outcome = await sendWhatsAppTextResult(route, to, text, options);
  return outcome.ok;
}
