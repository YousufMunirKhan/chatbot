import { requireRole } from '@/lib/auth';
import { YOUTUBE_SCOPES } from '@/lib/channels/google-oauth';
import { ROLES } from '@/lib/constants';
import { youtubeRedirectUri } from '@/lib/channels/youtube-oauth';
import { serverEnv } from '@/lib/env';
import { getCompanyId } from '@/modules/company/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the YouTube connect flow.
 *
 * A YouTube channel used to be connected by pasting an access token, which
 * Google expires after an hour — the channel then stopped answering comments
 * with nothing on screen to say why. Consent is requested offline here so a
 * refresh token comes back and the connection keeps working.
 */
export async function GET() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const e = serverEnv();
  if (!e.GOOGLE_CLIENT_ID) {
    return Response.json({ error: 'Google OAuth is not configured.' }, { status: 400 });
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', e.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', youtubeRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', YOUTUBE_SCOPES);
  url.searchParams.set('state', companyId);
  return Response.redirect(url.toString());
}
