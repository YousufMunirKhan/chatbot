import { NextResponse } from 'next/server';
import {
  authenticateHelpdeskConnector,
  connectorStatusPayload,
  eventResultSchema,
  logConnectorHealth,
  updateConnectorDeliveryState,
} from '@/lib/helpdesk/connectors';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { updateHelpdeskAuditLogForEvent } from '@/lib/helpdesk/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  const startedAt = Date.now();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('helpdesk_connector_events')
    .select('id,event_name,request_json,created_at')
    .eq('connector_id', connector.id)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length) {
    await sb
      .from('helpdesk_connector_events')
      .update({ status: 'running', claimed_at: new Date().toISOString() })
      .eq('connector_id', connector.id)
      .in('id', ids);
  }

  await updateConnectorDeliveryState(connector, {
    activeDeliveryMode: 'polling_fallback',
    connectionState: 'fallback',
    lastPollAt: new Date().toISOString(),
  });
  await logConnectorHealth(connector, {
    eventType: 'poll_success',
    deliveryMode: 'polling_fallback',
    status: 'success',
    durationMs: Date.now() - startedAt,
    eventsReturned: ids.length,
    pollIntervalSeconds: connector.pollIntervalSeconds,
  });

  return NextResponse.json({
    ok: true,
    ...connectorStatusPayload(connector),
    events: (data ?? []).map((event) => ({
      id: event.id,
      name: event.event_name,
      input: event.request_json,
      createdAt: event.created_at,
    })),
  });
}

export async function POST(req: Request) {
  const connector = await authenticateHelpdeskConnector(req);
  if (!connector) return NextResponse.json({ error: 'unauthorized_connector' }, { status: 401 });

  const parsed = eventResultSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from('helpdesk_connector_events')
    .update({
      status: parsed.data.status,
      response_json: parsed.data.response ?? null,
      error_message: parsed.data.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('connector_id', connector.id)
    .eq('id', parsed.data.eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logConnectorHealth(connector, {
    eventType: parsed.data.status === 'completed' ? 'event_completed' : 'event_failed',
    deliveryMode: parsed.data.deliveryMode,
    status: parsed.data.status === 'completed' ? 'success' : 'error',
    eventId: parsed.data.eventId,
    durationMs: parsed.data.durationMs,
    message: parsed.data.error,
  });

  await updateHelpdeskAuditLogForEvent({
    companyId: connector.companyId,
    eventId: parsed.data.eventId,
    status: parsed.data.status,
    response: parsed.data.response ?? null,
    errorMessage: parsed.data.error ?? null,
    deliveryMode: parsed.data.deliveryMode,
    metadata: {
      durationMs: parsed.data.durationMs ?? null,
      source: 'connector_event_result',
    },
  });

  return NextResponse.json({ ok: true });
}
