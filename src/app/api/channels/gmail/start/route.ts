import { requireRole } from '@/lib/auth';
import { GMAIL_SCOPES } from '@/lib/channels/adapters/gmail';
import { gmailRedirectUri } from '@/lib/channels/gmail-oauth';
import { ROLES } from '@/lib/constants';
import { serverEnv } from '@/lib/env';
import { getCompanyId } from '@/modules/company/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the Gmail connect flow (Channels → Connect Gmail).
 *
 * Mirrors the Google Calendar integration: consent is requested offline so a
 * refresh token comes back, and `state` carries the company so the callback can
 * check it against the signed-in admin's own company before storing anything.
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
  url.searchParams.set('redirect_uri', gmailRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', GMAIL_SCOPES);
  url.searchParams.set('state', companyId);
  return Response.redirect(url.toString());
}
