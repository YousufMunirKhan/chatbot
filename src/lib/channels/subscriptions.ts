/**
 * Marketing opt-in / opt-out ledger.
 *
 * WhatsApp's Business Policy (and GDPR / Saudi PDPL) require that a STOP
 * keyword is honoured immediately and that consent is auditable. Every
 * broadcast checks this table before it sends, and the inbound pipeline calls
 * `handleOptKeyword` on each message so an opt-out lands within one message
 * rather than one support ticket.
 *
 * `handleOptKeyword` is pure so the keyword matrix (English + Arabic) can be
 * asserted in tests without a database.
 */

import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';

export type OptAction = 'opt_out' | 'opt_in';
export type SubscriptionSource = 'keyword' | 'widget' | 'import' | 'manual' | 'api';

/**
 * Arabic is written with several interchangeable letter forms and optional
 * diacritics; a customer typing "إيقاف" must match "ايقاف". Latin text is
 * lowercased and stripped of punctuation for the same reason.
 */
export function normalizeKeyword(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا') // alef forms -> ا
    .replace(/ى/g, 'ي') // alef maqsura -> ي
    .replace(/ة/g, 'ه') // ta marbuta -> ه
    .replace(/[.!?,;:"'()،؟؛]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stop all',
  'unsubscribe',
  'end',
  'quit',
  'cancel',
  'opt out',
  'optout',
  'ايقاف',
  'توقف',
  'الغاء',
  'الغاء الاشتراك',
  'إلغاء الاشتراك',
  'لا اريد',
]);

const OPT_IN_KEYWORDS = new Set([
  'start',
  'subscribe',
  'unstop',
  'yes',
  'opt in',
  'optin',
  'اشتراك',
  'ابدا',
  'اشترك',
  'موافق',
  'نعم',
]);

/**
 * Classify an inbound message as an opt-out / opt-in command.
 *
 * Matches the whole message only: "please stop sending me offers" is a support
 * complaint, not the compliance keyword, and we must not silently unsubscribe
 * someone who used the word in a sentence.
 */
export function handleOptKeyword(text: string): OptAction | null {
  const value = normalizeKeyword(text);
  if (!value) return null;
  // Opt-out is checked first: "الغاء الاشتراك" contains the opt-in word.
  if (OPT_OUT_KEYWORDS.has(value)) return 'opt_out';
  if (OPT_IN_KEYWORDS.has(value)) return 'opt_in';
  return null;
}

/**
 * Is this contact reachable for marketing?
 *
 * Absence of a row means "never asked" — treated as opted in for a contact the
 * company already holds as a lead, matching how the previous broadcast
 * behaviour worked. Only an explicit opt-out blocks a send.
 */
export async function isOptedIn(
  companyId: string,
  channel: string,
  contactIdentifier: string,
): Promise<boolean> {
  if (!companyId || !contactIdentifier) return false;
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contact_subscriptions')
    .select('opted_in')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('contact_identifier', contactIdentifier)
    .maybeSingle();
  if (!data) return true;
  return (data as { opted_in: boolean }).opted_in !== false;
}

/** Record a consent change. Idempotent — one row per (company, channel, contact). */
export async function setOptIn(
  companyId: string,
  channel: string,
  contactIdentifier: string,
  optedIn: boolean,
  source: SubscriptionSource = 'manual',
): Promise<boolean> {
  if (!companyId || !contactIdentifier) return false;
  const now = new Date().toISOString();
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('contact_subscriptions').upsert(
    {
      company_id: companyId,
      channel,
      contact_identifier: contactIdentifier,
      opted_in: optedIn,
      source,
      opted_in_at: optedIn ? now : null,
      opted_out_at: optedIn ? null : now,
      updated_at: now,
    },
    { onConflict: 'company_id,channel,contact_identifier' },
  );
  if (error) {
    logger.warn('Failed to record subscription change', { companyId, channel, error: error.message });
    return false;
  }
  return true;
}

/**
 * Every contact this company has explicitly opted OUT of `channel`.
 * Returned as a Set so a broadcast run filters thousands of leads in memory
 * instead of issuing one query per recipient.
 */
export async function listOptedOut(companyId: string, channel: string): Promise<Set<string>> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contact_subscriptions')
    .select('contact_identifier')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('opted_in', false)
    .limit(50000);
  return new Set((data ?? []).map((r) => (r as { contact_identifier: string }).contact_identifier));
}

/** Contacts who explicitly opted IN — the audience for `audience='opted_in'`. */
export async function listOptedIn(companyId: string, channel: string): Promise<string[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('contact_subscriptions')
    .select('contact_identifier')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('opted_in', true)
    .limit(50000);
  return (data ?? []).map((r) => (r as { contact_identifier: string }).contact_identifier);
}
