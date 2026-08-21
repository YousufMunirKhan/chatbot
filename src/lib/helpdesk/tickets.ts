import { assignBestAvailableAgent } from '@/lib/agent-routing';
import { logAppError } from '@/lib/application-errors';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { allocateTicketNumber } from '@/lib/tickets/ticket-number';
import { getSupportSettingsFor } from '@/modules/company/support-settings-data';

export async function createConnectorIssueTicket(input: {
  companyId: string;
  connectorId: string;
  connectorName: string;
  eventId: string;
  eventName: string;
  reason: 'failed' | 'timeout';
  error?: string | null;
  response?: Record<string, unknown> | null;
  eventCreatedAt?: string | null;
}) {
  const settings = await getSupportSettingsFor(input.companyId);
  if (!settings.autoTicketConnectorFailures) return null;
  if (input.reason === 'timeout' && input.eventCreatedAt) {
    const ageMs = Date.now() - new Date(input.eventCreatedAt).getTime();
    if (ageMs < settings.connectorFailureTicketDelayMinutes * 60 * 1000) return null;
  }

  const sb = createSupabaseServiceClient();
  const { data: existing } = await sb
    .from('conversations')
    .select('id')
    .eq('company_id', input.companyId)
    .contains('state_json', { eventId: input.eventId })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const now = new Date().toISOString();
  const issueType = input.reason === 'timeout' ? 'stayed queued too long' : 'failed';
  const ticketNumber = await allocateTicketNumber(input.companyId);
  const subject = `${input.connectorName} action ${issueType}: ${input.eventName}`;
  const details = input.error || (input.reason === 'timeout'
    ? 'Connector action stayed queued/running longer than the configured warning time.'
    : 'Connector action failed without a detailed error message.');
  const source = input.reason === 'timeout' ? 'connector_timeout' : 'connector_failure';

  const { data: convo, error } = await sb
    .from('conversations')
    .insert({
      company_id: input.companyId,
      channel: 'api',
      status: 'needs_human',
      ai_enabled: false,
      visitor_id: `connector:${input.connectorId}`,
      priority: input.reason === 'timeout' ? 'normal' : 'high',
      tags: ['helpdesk', 'connector', 'issue'],
      unread_count: 1,
      last_message_at: now,
      state_json: {
        source,
        ticketNumber,
        connectorId: input.connectorId,
        connectorName: input.connectorName,
        eventId: input.eventId,
        eventName: input.eventName,
      },
    })
    .select('id')
    .single();
  if (error || !convo) throw new Error(error?.message ?? 'Could not create connector issue ticket.');

  const conversationId = convo.id as string;
  await sb.from('messages').insert({
    company_id: input.companyId,
    conversation_id: conversationId,
    channel: 'api',
    sender_type: 'system',
    content_text: `${ticketNumber} connector action ${issueType}: ${input.eventName}`,
    content_type: 'system',
    metadata_json: {
      source,
      ticketNumber,
      connectorId: input.connectorId,
      connectorName: input.connectorName,
      eventId: input.eventId,
      error: details,
    },
  });

  await sb.from('conversation_internal_notes').insert({
    company_id: input.companyId,
    conversation_id: conversationId,
    note: [
      `Ticket: ${ticketNumber}`,
      `Subject: ${subject}`,
      `Connector: ${input.connectorName}`,
      `Event: ${input.eventName}`,
      `Event ID: ${input.eventId}`,
      '',
      details,
      input.response ? `Response: ${JSON.stringify(input.response).slice(0, 2000)}` : null,
    ].filter(Boolean).join('\n'),
  });

  const assignedAgentId = await assignBestAvailableAgent(input.companyId, conversationId);
  await notify({
    companyId: input.companyId,
    type: 'helpdesk_issue_reported',
    title: subject,
    body: details,
    data: {
      conversationId,
      ticketNumber,
      assignedAgentId,
      connectorId: input.connectorId,
      connectorName: input.connectorName,
      eventId: input.eventId,
      eventName: input.eventName,
      source: `${source}_auto_ticket`,
    },
    email: true,
  });

  await logAppError({
    companyId: input.companyId,
    conversationId,
    source: `${source}_auto_ticket`,
    severity: input.reason === 'timeout' ? 'warning' : 'error',
    message: subject,
    route: '/company/help-desk?tab=logs',
    metadata: {
      ticketNumber,
      connectorId: input.connectorId,
      connectorName: input.connectorName,
      eventId: input.eventId,
      eventName: input.eventName,
      error: details,
      delivery: 'inbox_ticket_company_notification_platform_log',
    },
  });

  return conversationId;
}
