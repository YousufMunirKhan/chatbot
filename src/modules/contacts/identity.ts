import { toE164 } from '@/lib/channels/sms';

/**
 * Identity normalisation, shared by the readers and the actions in this module.
 *
 * These two functions are the TypeScript half of a rule that also exists in SQL
 * (`public.contact_normalize_phone` / `public.contact_normalize_email`, in
 * migration 0076). The database is the authority — it is what the triggers and
 * the backfill use, and it is what the unique index protects — so nothing here
 * may disagree with it. The pair exists so that a page can normalise a search
 * box or a form field without a round trip, not so that resolution can happen
 * in two places.
 */

/**
 * "+" followed by digits, or null.
 *
 * `toE164` is the project's existing rule, used by the SMS channel to store the
 * `external_id` a Twilio webhook will be matched against. Reusing it rather
 * than writing a smarter one is the point: if contacts normalised
 * "+44 7700 900123" differently from the SMS channel, the same person would
 * hold two keys and the whole exercise would fail at its first WhatsApp
 * message. It does mean a national number ("07700 900123") is a different
 * identity from its international form; that limit is inherited, on purpose.
 */
export function normalizeContactPhone(value: string | null | undefined): string | null {
  const e164 = toE164(value);
  // `toE164('')` is '' and `toE164('abc')` is '' — both mean "no phone here".
  return e164.length > 1 ? e164 : null;
}

/** Lowercased and trimmed, or null when it could not be an address. */
export function normalizeContactEmail(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '')
    .trim()
    .toLowerCase();
  // The `> 0` is deliberate: "@example.com" identifies nobody, and storing it
  // would file every such enquiry under one shared person.
  return trimmed.indexOf('@') > 0 && trimmed.length > 2 ? trimmed : null;
}

/**
 * What to call someone who never gave a name.
 *
 * A contact always has at least one address — that is what made them a contact
 * — so there is always something better to show than "Unknown".
 */
export function contactDisplayName(contact: {
  displayName: string | null;
  emails: string[];
  phones: string[];
}): string {
  const named = (contact.displayName ?? '').trim();
  if (named) return named;
  return contact.emails[0] ?? contact.phones[0] ?? 'Someone who left no name';
}

/** Digits and a leading `+` only — `tel:` and `wa.me` both reject anything else. */
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function whatsappHref(phone: string): string {
  return `https://wa.me/${dialable(phone).replace(/^\+/, '')}`;
}
