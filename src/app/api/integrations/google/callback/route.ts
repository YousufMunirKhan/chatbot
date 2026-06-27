import { redirect } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { serverEnv, env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const companyId = url.searchParams.get('state');
  const e = serverEnv();
  if (!code || !companyId || !e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    redirect('/company/integrations?google=failed');
  }
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/integrations/google/callback`;
  const params = new URLSearchParams();
  params.set('code', code);
  params.set('client_id', e.GOOGLE_CLIENT_ID);
  params.set('client_secret', e.GOOGLE_CLIENT_SECRET);
  params.set('redirect_uri', redirectUri);
  params.set('grant_type', 'authorization_code');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) redirect('/company/integrations?google=failed');
  const token = await res.json();
  await createSupabaseServiceClient().from('integration_accounts').insert({
    company_id: companyId,
    provider: 'google_calendar',
    name: 'Google Calendar',
    status: 'connected',
    credentials_encrypted: encryptSecret(JSON.stringify({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      calendar_id: 'primary',
      timezone: 'UTC',
    })),
    settings_json: {},
  });
  redirect('/company/integrations?google=connected');
}
