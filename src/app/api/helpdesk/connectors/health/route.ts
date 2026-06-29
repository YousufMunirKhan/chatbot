import { NextResponse } from 'next/server';
import {
  authenticateHelpdeskConnector,
  connectorHealthSchema,
  logConnectorHealth,
  updateConnectorDeliveryState,
} from '@/lib/helpdesk/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  const parsed = connectorHealthSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const h = parsed.data;
  await logConnectorHealth(connector, h);

  if (h.eventType === 'websocket_connected') {
    await updateConnectorDeliveryState(connector, {
      activeDeliveryMode: 'websocket',
      connectionState: 'connected',
      fallbackReason: null,
      lastConnectedAt: now,
      lastError: null,
    });
  } else if (h.eventType === 'websocket_disconnected') {
    await updateConnectorDeliveryState(connector, {
      connectionState: 'degraded',
      lastDisconnectedAt: now,
      lastError: h.message ?? null,
    });
  } else if (h.eventType === 'fallback_started') {
    await updateConnectorDeliveryState(connector, {
      activeDeliveryMode: 'polling_fallback',
      connectionState: 'fallback',
      fallbackReason: h.message ?? 'WebSocket unavailable.',
      pollIntervalSeconds: h.pollIntervalSeconds,
    });
  } else if (h.eventType === 'fallback_stopped') {
    await updateConnectorDeliveryState(connector, {
      activeDeliveryMode: 'websocket',
      connectionState: 'connected',
      fallbackReason: null,
    });
  } else if (h.eventType === 'poll_attempt' || h.eventType === 'poll_success' || h.eventType === 'poll_failed') {
    await updateConnectorDeliveryState(connector, {
      activeDeliveryMode: 'polling_fallback',
      connectionState: h.eventType === 'poll_failed' ? 'degraded' : 'fallback',
      lastPollAt: now,
      pollIntervalSeconds: h.pollIntervalSeconds,
      lastError: h.eventType === 'poll_failed' ? h.message ?? null : null,
    });
  }

  return NextResponse.json({ ok: true });
}
