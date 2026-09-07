import { requireRole } from '@/lib/auth';
import { parseGoogleCredentials } from '@/lib/channels/google-oauth';
import { youtubeRedirectUri } from '@/lib/channels/youtube-oauth';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env, serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getCompanyId } from '@/modules/company/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');

function back(status: 'connected' | 'failed' | 'taken' | 'no_channel'): Response {
  return Response.redirect(`${APP}/company/channels?youtube=${status}`, 302);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * YouTube OAuth callback.
 *
 * Exchanges the code, reads which channel the grant covers, and stores the
 * credentials — refresh token included — on a `channel_identities` row keyed by
 * the YouTube channel id. The poller and the reply path both resolve a fresh
 * access token from that row, so the connection survives Google's one-hour
 * token expiry.
 */
export async function GET(req: Request): Promise<Response> {
  // The redirect lands in the admin's own browser session, so the company comes
  // from that session and `state` only has to agree with it.
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const e = serverEnv();
  if (!code || state !== companyId || !e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    return back('failed');
  }

  try {
    const params = new URLSearchParams({
      code,
      client_id: e.GOOGLE_CLIENT_ID,
      client_secret: e.GOOGLE_CLIENT_SECRET,
      redirect_uri: youtubeRedirectUri(),
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      cache: 'no-store',
    });
    if (!tokenRes.ok) return back('failed');
    const token = (await tokenRes.json()) as TokenResponse;
    if (!token.access_token) return back('failed');

    // Which channel did they grant us? `mine=true` answers for the signed-in
    // Google account, which is exactly the account that just consented.
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store' },
    );
    if (!channelRes.ok) return back('failed');
    const body = (await channelRes.json()) as {
      items?: Array<{ id?: string; snippet?: { title?: string } }>;
    };
    const channel = body.items?.[0];
    const channelId = channel?.id;
    // A Google account with no YouTube channel is a real and confusing case.
    if (!channelId) return back('no_channel');

    const sb = createSupabaseServiceClient();

    // TENANT ISOLATION: a channel maps to exactly one company so inbound
    // comments route unambiguously.
    const { data: existing } = await sb
      .from('channel_identities')
      .select('id,company_id,settings_json,secret_encrypted')
      .eq('channel', 'youtube')
      .eq('external_id', channelId)
      .maybeSingle();
    if (existing && (existing as { company_id: string }).company_id !== companyId) {
      logger.warn('YouTube connect blocked: channel belongs to another company', { channelId });
      return back('taken');
    }

    const row = (existing ?? {}) as {
      settings_json?: Record<string, unknown>;
      secret_encrypted?: string | null;
    };

    // Google returns a refresh token only on the first consent for a client, so
    // keep the stored one when this exchange did not include a new one.
    let refreshToken = token.refresh_token;
    if (!refreshToken && row.secret_encrypted) {
      try {
        refreshToken = parseGoogleCredentials(decryptSecret(row.secret_encrypted))?.refresh_token;
      } catch {
        refreshToken = undefined;
      }
    }

    const { error } = await sb.from('channel_identities').upsert(
      {
        company_id: companyId,
        channel: 'youtube',
        external_id: channelId,
        display_name: channel?.snippet?.title ?? channelId,
        secret_encrypted: encryptSecret(
          JSON.stringify({
            access_token: token.access_token,
            refresh_token: refreshToken,
            expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
          }),
        ),
        settings_json: { ...(row.settings_json ?? {}), provider: 'google_oauth' },
        is_active: true,
      },
      { onConflict: 'channel,external_id' },
    );
    if (error) {
      logger.error('YouTube connect failed to save', { error: error.message });
      return back('failed');
    }
    return back('connected');
  } catch (err) {
    logger.error('YouTube OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return back('failed');
  }
}
