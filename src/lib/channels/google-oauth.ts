import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { request } from './http';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Google OAuth credentials stored (encrypted) on a `channel_identities` row.
 *
 * Shared by Gmail and YouTube. Both are Google APIs whose access tokens expire
 * after an hour; storing only the access token — as the YouTube channel first
 * did — means the connection works for one hour and then silently stops, with
 * nothing in the UI to explain why.
 */
export interface GoogleCredentials {
  access_token?: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at?: number;
  email?: string;
}

export function parseGoogleCredentials(secret: string | null): GoogleCredentials | null {
  if (!secret) return null;
  try {
    const parsed = JSON.parse(secret) as GoogleCredentials;
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    // A bare access token pasted by hand is still usable until it expires.
    return { access_token: secret };
  }
}

/**
 * Return a valid access token, refreshing when it is within 60s of expiry.
 * `refreshed` is non-null only when the caller should persist new credentials.
 */
export async function ensureGoogleAccessToken(
  creds: GoogleCredentials,
): Promise<{ accessToken: string | null; refreshed: GoogleCredentials | null }> {
  const stillValid = creds.access_token && (!creds.expires_at || creds.expires_at - Date.now() > 60_000);
  if (stillValid) return { accessToken: creds.access_token ?? null, refreshed: null };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!creds.refresh_token || !clientId || !clientSecret) {
    // Nothing to refresh with — hand back whatever we have and let the call fail
    // loudly at the API rather than pretending the connection is healthy.
    return { accessToken: creds.access_token ?? null, refreshed: null };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await request<{ access_token?: string; expires_in?: number }>(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const accessToken = res.body?.access_token;
  if (!res.ok || !accessToken) {
    logger.warn('Google token refresh failed', { status: res.status });
    return { accessToken: null, refreshed: null };
  }

  return {
    accessToken,
    refreshed: {
      ...creds,
      access_token: accessToken,
      expires_at: Date.now() + (res.body?.expires_in ?? 3600) * 1000,
    },
  };
}

/** Write refreshed credentials back to the channel row, encrypted. */
export async function persistGoogleCredentials(
  identityId: string,
  credentials: GoogleCredentials,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('channel_identities')
    .update({ secret_encrypted: encryptSecret(JSON.stringify(credentials)) })
    .eq('id', identityId);
  if (error) logger.warn('Could not persist refreshed Google credentials', { error: error.message });
}

/**
 * Load a usable access token for one channel row, refreshing and persisting as
 * needed. Returns null when the connection can no longer authenticate.
 */
export async function accessTokenForIdentity(params: {
  identityId: string;
  secretEncrypted: string | null;
  decrypt: (value: string) => string;
}): Promise<string | null> {
  if (!params.secretEncrypted) return null;
  let raw: string;
  try {
    raw = params.decrypt(params.secretEncrypted);
  } catch {
    raw = params.secretEncrypted; // tolerate a plaintext value stored in dev
  }
  const creds = parseGoogleCredentials(raw);
  if (!creds) return null;

  const { accessToken, refreshed } = await ensureGoogleAccessToken(creds);
  if (refreshed) await persistGoogleCredentials(params.identityId, refreshed);
  return accessToken;
}

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
