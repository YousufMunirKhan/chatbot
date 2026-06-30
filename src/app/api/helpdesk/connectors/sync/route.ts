import { NextResponse } from 'next/server';
import {
  authenticateHelpdeskConnector,
  connectorStatusPayload,
  connectorSyncSchema,
  logConnectorHealth,
  syncConnectorPayload,
} from '@/lib/helpdesk/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  await logConnectorHealth(connector, {
    eventType: 'sync_started',
    deliveryMode: connector.activeDeliveryMode,
    status: 'info',
  });

  const parsed = connectorSyncSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    await logConnectorHealth(connector, {
      eventType: 'sync_failed',
      deliveryMode: connector.activeDeliveryMode,
      status: 'error',
      message: 'Invalid connector sync payload.',
      metadata: { issues: parsed.error.issues },
    });
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await syncConnectorPayload(connector, parsed.data);
    await logConnectorHealth(connector, {
      eventType: 'sync_completed',
      deliveryMode: connector.activeDeliveryMode,
      status: 'success',
      metadata: result,
    });
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
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Connector sync failed on the server.';
    await logConnectorHealth(connector, {
      eventType: 'sync_failed',
      deliveryMode: connector.activeDeliveryMode,
      status: 'error',
      message,
      metadata: {
        name: error instanceof Error ? error.name : typeof error,
      },
    });
    return NextResponse.json(
      { error: 'sync_failed', message },
      { status: 500 },
    );
  }
}
