import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import type { BotContext } from '@/lib/ai/engine';
import { loadBotByPublicId } from '@/lib/ai/engine';
import { logger } from '@/lib/logger';

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
 * Send a free-form WhatsApp text reply. Allowed inside the 24h customer-service
 * window (which an inbound message opens), so we use a plain text message rather
 * than a template.
 */
export async function sendWhatsAppText(route: WhatsAppRoute, to: string, text: string): Promise<boolean> {
  if (route.provider !== 'meta_cloud' || !route.metaToken || !route.metaPhoneNumberId) {
    logger.warn('WhatsApp reply skipped: provider not configured for inbound text', { companyId: route.companyId });
    return false;
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
      logger.error('Meta WhatsApp text send failed', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Meta WhatsApp text send threw', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
