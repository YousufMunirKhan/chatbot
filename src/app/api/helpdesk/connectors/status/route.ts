import { NextResponse } from 'next/server';
import { authenticateHelpdeskConnector, connectorStatusPayload } from '@/lib/helpdesk/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  return NextResponse.json({
    ok: true,
    connector: {
      id: connector.id,
      platform: connector.platform,
      name: connector.name,
      status: connector.status,
    },
    ...connectorStatusPayload(connector),
    serverTime: new Date().toISOString(),
  });
}
