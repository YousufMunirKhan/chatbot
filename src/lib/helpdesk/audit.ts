import { createSupabaseServiceClient } from '@/lib/db/server';

export type HelpdeskAuditStatus =
  | 'info'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'confirmation_required';

export async function insertHelpdeskAuditLog(input: {
  companyId: string;
  connectorId?: string | null;
  actionId?: string | null;
  eventId?: string | null;
  actorUserId?: string | null;
  source?: 'chat' | 'dashboard' | 'connector' | 'system';
  actionName?: string | null;
  question?: string | null;
  answer?: string | null;
  confirmationRequired?: boolean;
  confirmed?: boolean;
  dryRun?: boolean;
  status?: HelpdeskAuditStatus;
  input?: Record<string, unknown>;
  response?: unknown;
  errorMessage?: string | null;
  deliveryMode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('helpdesk_action_audit_logs').insert({
    company_id: input.companyId,
    connector_id: input.connectorId ?? null,
    action_id: input.actionId ?? null,
    event_id: input.eventId ?? null,
    actor_user_id: input.actorUserId ?? null,
    source: input.source ?? 'chat',
    action_name: input.actionName ?? null,
    question: input.question ?? null,
    answer: input.answer ?? null,
    confirmation_required: input.confirmationRequired ?? false,
    confirmed: input.confirmed ?? false,
    dry_run: input.dryRun ?? false,
    status: input.status ?? 'info',
    input_json: input.input ?? {},
    response_json: input.response ?? null,
    error_message: input.errorMessage ?? null,
    delivery_mode: input.deliveryMode ?? null,
    metadata_json: input.metadata ?? {},
    completed_at: ['completed', 'failed', 'cancelled'].includes(input.status ?? '') ? new Date().toISOString() : null,
  });
}

export async function updateHelpdeskAuditLogForEvent(input: {
  companyId: string;
  eventId: string;
  status: HelpdeskAuditStatus;
  response?: unknown;
  errorMessage?: string | null;
  deliveryMode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const update: Record<string, unknown> = {
    status: input.status,
    response_json: input.response ?? null,
    error_message: input.errorMessage ?? null,
    completed_at: ['completed', 'failed', 'cancelled'].includes(input.status) ? new Date().toISOString() : null,
  };
  if (input.deliveryMode) update.delivery_mode = input.deliveryMode;
  if (input.metadata) update.metadata_json = input.metadata;

  await sb
    .from('helpdesk_action_audit_logs')
    .update(update)
    .eq('company_id', input.companyId)
    .eq('event_id', input.eventId);
}
