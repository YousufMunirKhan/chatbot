import { NextResponse } from 'next/server';
import {
  authenticateHelpdeskConnector,
  connectorStatusPayload,
  connectorSyncSchema,
  syncConnectorPayload,
} from '@/lib/helpdesk/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  const parsed = connectorSyncSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await syncConnectorPayload(connector, parsed.data);
  return NextResponse.json({
    ok: true,
    connector: {
      id: connector.id,
      platform: connector.platform,
      name: connector.name,
    },
    ...connectorStatusPayload({ ...connector, lastSyncAt: new Date().toISOString(), resyncRequestedAt: null }),
    ...result,
  });
}
