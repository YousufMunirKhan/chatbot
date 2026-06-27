import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { getCompanyId } from '@/modules/company/data';

const schema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

export async function POST(req: Request) {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 });
  const sb = createSupabaseServiceClient();
  const { data: integration } = await sb
    .from('integration_accounts')
    .select('credentials_encrypted')
    .eq('company_id', companyId)
    .eq('provider', 'google_calendar')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle();
  if (!integration?.credentials_encrypted) return Response.json({ error: 'calendar_not_connected' }, { status: 404 });
  const creds = JSON.parse(decryptSecret(integration.credentials_encrypted as string));
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: parsed.data.start,
      timeMax: parsed.data.end,
      items: [{ id: creds.calendar_id || 'primary' }],
    }),
  });
  if (!res.ok) return Response.json({ error: 'google_error' }, { status: 502 });
  return Response.json(await res.json());
}
