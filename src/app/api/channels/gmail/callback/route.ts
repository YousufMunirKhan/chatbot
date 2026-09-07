import { requireRole } from '@/lib/auth';
import { parseGmailCredentials } from '@/lib/channels/adapters/gmail';
import { gmailRedirectUri } from '@/lib/channels/gmail-oauth';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { env, serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getCompanyId } from '@/modules/company/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');

function back(status: 'connected' | 'failed' | 'taken'): Response {
  return Response.redirect(`${APP}/company/channels?gmail=${status}`, 302);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Gmail OAuth callback.
 *
 * Exchanges the code, reads the mailbox address it was granted for, and stores
 * the credentials on a `channel_identities` row keyed by that address. The
 * email adapter picks the Gmail send path purely from
 * `settings_json.provider === 'gmail'`, so no other code has to know how the
 * mailbox was connected.
 */
export async function GET(req: Request): Promise<Response> {
  // The redirect lands in the admin's own browser session, so the company is
  // taken from that session and `state` only has to agree with it — a stray or
  // forged state can never attach a mailbox to someone else's tenant.
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
      redirect_uri: gmailRedirectUri(),
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

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: 'no-store',
    });
    if (!infoRes.ok) return back('failed');
    const info = (await infoRes.json()) as { email?: string };
    const address = info.email?.trim().toLowerCase();
    if (!address) return back('failed');

    const sb = createSupabaseServiceClient();

    // TENANT ISOLATION: an inbox address maps to exactly one company, so inbound
    // mail routes unambiguously. Never take over another tenant's mailbox.
    const { data: existing } = await sb
      .from('channel_identities')
      .select('id,company_id,settings_json,secret_encrypted')
      .eq('channel', 'email')
      .eq('external_id', address)
      .maybeSingle();
    if (existing && (existing as { company_id: string }).company_id !== companyId) {
      logger.warn('Gmail connect blocked: address belongs to another company', { address });
      return back('taken');
    }

    const row = (existing ?? {}) as { settings_json?: Record<string, unknown>; secret_encrypted?: string | null };
    const previous = row.settings_json ?? {};

    // Google only returns a refresh token on the first consent for a client, so
    // keep the stored one when this exchange did not include a new one.
    let refreshToken = token.refresh_token;
    if (!refreshToken && row.secret_encrypted) {
      try {
        refreshToken = parseGmailCredentials(decryptSecret(row.secret_encrypted))?.refresh_token;
      } catch {
        refreshToken = undefined;
      }
    }

    const { error } = await sb.from('channel_identities').upsert(
      {
        company_id: companyId,
        channel: 'email',
        external_id: address,
        display_name: address,
        secret_encrypted: encryptSecret(
          JSON.stringify({
            access_token: token.access_token,
            refresh_token: refreshToken,
            expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
            email: address,
          }),
        ),
        settings_json: { ...previous, provider: 'gmail' },
        is_active: true,
      },
      { onConflict: 'channel,external_id' },
    );
    if (error) {
      logger.error('Gmail connect failed to save', { error: error.message });
      return back('failed');
    }
    return back('connected');
  } catch (err) {
    logger.error('Gmail OAuth callback failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return back('failed');
  }
}
