import { toE164WithDialCode } from '@/lib/channels/sms';

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
 *
 * ONE DELIBERATE DIFFERENCE, FOR NOW
 * `normalizeContactPhone` accepts the company's dial code and the SQL function
 * cannot: it is `immutable` and takes only the value, so it has no company to
 * ask and keeps writing the national form. That is why the conversion below is
 * applied on the way OUT (see `displayPhone`, and its use in
 * `contacts-data.ts`) rather than on the way in — a national number and its
 * international twin are still two rows in `contact_identities` until the SQL
 * rule learns the same trick, and showing one number two ways is honest where
 * writing one number two ways would not be. Filing them as one person needs a
 * company-aware `contact_normalize_phone`, which belongs in a migration that
 * owns 0076's functions, not here.
 */

/**
 * "+" followed by digits, or null.
 *
 * Built on `toE164`, the project's existing rule, used by the SMS channel to
 * store the `external_id` a Twilio webhook will be matched against. Reusing it
 * rather than writing a smarter one is the point: if contacts normalised
 * "+44 7700 900123" differently from the SMS channel, the same person would
 * hold two keys and the whole exercise would fail at its first WhatsApp
 * message.
 *
 * `dialCode` is the company's own calling code, from its business profile. With
 * one, a number written nationally ("07700 900123") resolves to the same
 * identity as the international form the WhatsApp webhook delivers
 * ("+447700900123") — which is the whole reason a company sets it. Without one
 * the two stay separate, exactly as they were before this argument existed: an
 * unset dial code must never be read as "assume the UK".
 */
export function normalizeContactPhone(
  value: string | null | undefined,
  dialCode?: string | null,
): string | null {
  const e164 = toE164WithDialCode(value, dialCode);
  // `toE164('')` is '' and `toE164('abc')` is '' — both mean "no phone here".
  return e164.length > 1 ? e164 : null;
}

/**
 * A stored phone as it should be shown and linked, given the company's dial
 * code.
 *
 * Rows written before the company set a dial code — and every row written by
 * the database's own normaliser, which has no company to ask — hold the
 * national form. Converting on the way out is what makes the Call and WhatsApp
 * buttons beside them work without rewriting history. Anything already
 * international, and anything at all when no dial code is set, comes back
 * untouched.
 */
export function displayPhone(phone: string, dialCode?: string | null): string {
  return normalizeContactPhone(phone, dialCode) ?? phone;
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

/**
 * wa.me only routes an INTERNATIONAL number: it takes the digits after the `+`
 * and nothing else, so a national number sends the agent to a page about an
 * account that does not exist. `dialCode` is optional because most callers hand
 * in a phone the reader has already converted; passing it is the way for a
 * caller holding a raw stored value to get a working link anyway.
 */
export function whatsappHref(phone: string, dialCode?: string | null): string {
  return `https://wa.me/${dialable(displayPhone(phone, dialCode)).replace(/^\+/, '')}`;
}
