import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getCompanyId } from '@/modules/company/data';
import { serverEnv, env } from '@/lib/env';

export const runtime = 'nodejs';

export async function GET() {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const e = serverEnv();
  if (!e.GOOGLE_CLIENT_ID) return Response.json({ error: 'Google OAuth is not configured.' }, { status: 400 });
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/integrations/google/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', e.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
  url.searchParams.set('state', companyId);
  return Response.redirect(url.toString());
}
