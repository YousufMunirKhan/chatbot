import { NextResponse } from 'next/server';
import {
  authenticateHelpdeskConnector,
  logConnectorHealth,
  updateConnectorDeliveryState,
} from '@/lib/helpdesk/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  await logConnectorHealth(connector, {
    eventType: 'websocket_reconnect_failed',
    deliveryMode: 'websocket',
    status: 'warning',
    message: 'WebSocket gateway is not enabled in this Next.js process. Connector should use polling fallback.',
  });
  await updateConnectorDeliveryState(connector, {
    connectionState: 'degraded',
    lastDisconnectedAt: new Date().toISOString(),
    lastError: 'WebSocket gateway is not enabled in this deployment.',
  });

  return NextResponse.json(
    {
      error: 'websocket_gateway_not_enabled',
      fallback: 'polling_fallback',
      message:
        'Run the dedicated connector WebSocket gateway or use safe polling fallback.',
    },
    { status: 426 },
  );
}
