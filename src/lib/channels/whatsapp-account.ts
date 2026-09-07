/**
 * WhatsApp Business account health.
 *
 * Quality rating and messaging limit decide whether a broadcast will actually
 * be delivered — a number that has dropped to RED is throttled and, left
 * unattended, disconnected. Surfacing both in the dashboard turns a silent
 * account death into something the company can act on.
 */

import { getJson } from './http';

const GRAPH = 'https://graph.facebook.com/v19.0';

export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export interface WhatsAppAccountStatus {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: QualityRating;
  messagingLimit: string | null;
  /** Green/blue tick state: NONE | PENDING_REVIEW | APPROVED | DECLINED… */
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  error?: string;
}

interface PhoneNumberRow {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  name_status?: string;
  code_verification_status?: string;
  error?: { message?: string };
}

/** Human wording for Meta's messaging limit tiers. */
export function describeMessagingLimit(tier: string | null | undefined): string {
  switch (String(tier ?? '').toUpperCase()) {
    case 'TIER_50':
      return '50 customers / 24h';
    case 'TIER_250':
      return '250 customers / 24h';
    case 'TIER_1K':
      return '1,000 customers / 24h';
    case 'TIER_10K':
      return '10,000 customers / 24h';
    case 'TIER_100K':
      return '100,000 customers / 24h';
    case 'TIER_UNLIMITED':
      return 'Unlimited';
    default:
      return 'Not reported yet';
  }
}

function toQuality(value: string | null | undefined): QualityRating {
  const v = String(value ?? '').toUpperCase();
  return v === 'GREEN' || v === 'YELLOW' || v === 'RED' ? v : 'UNKNOWN';
}

/**
 * Read the connected number's health from the Graph API.
 * Returns an `error` (never throws) so the page still renders without a token.
 */
export async function fetchWhatsAppAccountStatus(
  token: string,
  phoneNumberId: string,
): Promise<WhatsAppAccountStatus> {
  const empty: WhatsAppAccountStatus = {
    displayPhoneNumber: null,
    verifiedName: null,
    qualityRating: 'UNKNOWN',
    messagingLimit: null,
    nameStatus: null,
    codeVerificationStatus: null,
  };
  if (!token || !phoneNumberId) return { ...empty, error: 'No WhatsApp access token stored.' };

  const fields = 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status';
  const res = await getJson<PhoneNumberRow>(`${GRAPH}/${phoneNumberId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) {
    return { ...empty, error: res.body?.error?.message ?? res.error ?? `Graph API returned HTTP ${res.status}` };
  }
  const row = res.body;
  return {
    displayPhoneNumber: row.display_phone_number ?? null,
    verifiedName: row.verified_name ?? null,
    qualityRating: toQuality(row.quality_rating),
    messagingLimit: describeMessagingLimit(row.messaging_limit_tier),
    nameStatus: row.name_status ?? null,
    codeVerificationStatus: row.code_verification_status ?? null,
  };
}
