import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { authenticateHelpdeskConnector } from '@/lib/helpdesk/connectors';
import { createConnectorIssueTicket } from '@/lib/helpdesk/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(obj: unknown, status = 200) {
  return NextResponse.json(obj, { status });
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function displayText(input: {
  eventName: string;
  status: string;
  response: unknown;
  error: string | null;
}): string {
  const label = input.eventName.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  if (input.status === 'completed') {
    const response = input.response as Record<string, unknown> | null;
    const message = response && typeof response === 'object' && typeof response.message === 'string'
      ? response.message
      : formatValue(input.response);
    return `${label} completed.${message ? `\n\n${message}` : ''}`;
  }
  if (input.status === 'failed' || input.status === 'cancelled') {
    return `${label} ${input.status}: ${input.error ?? 'No details returned.'}`;
  }
  return `${label} is still ${input.status}.`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  const connector = user?.companyId ? null : await authenticateHelpdeskConnector(_req);
  const companyId = user?.companyId ?? connector?.companyId ?? null;
  if (!companyId) return json({ error: 'unauthorized' }, 401);
  if (user && user.role !== ROLES.COMPANY_ADMIN && user.role !== ROLES.AGENT && !user.isSuperAdmin) {
    return json({ error: 'forbidden' }, 403);
  }

  let query = createSupabaseServiceClient()
    .from('helpdesk_connector_events')
    .select('id,connector_id,event_name,status,response_json,error_message,created_at,completed_at')
    .eq('company_id', companyId)
    .eq('id', params.id);
  if (connector?.id) query = query.eq('connector_id', connector.id);
  const { data, error } = await query.maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'event_not_found' }, 404);

  const row = data as Record<string, unknown>;
  const status = String(row.status ?? 'queued');
  const response = row.response_json ?? null;
  const errorMessage = (row.error_message as string | null) ?? null;
  let autoTicketConversationId: string | null = null;

  if (status === 'queued' || status === 'running') {
    try {
      const connectorId = row.connector_id as string;
      const connectorName = connector?.id === connectorId
        ? connector.name
        : ((await createSupabaseServiceClient()
            .from('helpdesk_connectors')
            .select('name')
            .eq('company_id', companyId)
            .eq('id', connectorId)
            .maybeSingle()).data?.name as string | undefined) ?? 'Connector';
      autoTicketConversationId = await createConnectorIssueTicket({
        companyId,
        connectorId,
        connectorName,
        eventId: String(row.id),
        eventName: String(row.event_name ?? 'connector_action'),
        reason: 'timeout',
        eventCreatedAt: (row.created_at as string | null) ?? null,
      });
    } catch {
      autoTicketConversationId = null;
    }
  }

  return json({
    ok: true,
    eventId: row.id,
    eventName: row.event_name,
    status,
    response,
    error: errorMessage,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    autoTicketConversationId,
    displayText: displayText({
      eventName: String(row.event_name ?? 'connector_action'),
      status,
      response,
      error: errorMessage,
    }),
  });
}
