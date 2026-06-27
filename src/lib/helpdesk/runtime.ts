import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';
import type { ToolContext } from '@/lib/tools/types';

const HELP_DESK_ACTION_TIMEOUT_MS = 18_000;
const HELP_DESK_ACTION_POLL_MS = 1_000;

export interface HelpdeskRuntimeAction {
  id: string;
  connectorId: string;
  connectorName: string;
  connectorPlatform: string;
  name: string;
  description: string;
  actionType: string;
  risk: string;
  requiredFields: string[];
  optionalFields: string[];
  allowedRoles: string[];
  needsConfirmation: boolean;
}

const runActionSchema = z.object({
  action_name: z.string().min(2).max(120),
  connector_id: z.string().uuid().optional(),
  input: z.record(z.unknown()).default({}),
  confirmed: z.boolean().default(false),
});

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function hasHelpdeskRuntime(capabilityFlags: string[]): boolean {
  const caps = new Set(capabilityFlags);
  return (
    caps.has('help_desk') ||
    caps.has('internal_process_guide') ||
    [...caps].some((cap) => cap.startsWith('internal_'))
  );
}

export async function listEnabledHelpdeskActions(companyId: string): Promise<HelpdeskRuntimeAction[]> {
  const sb = createSupabaseServiceClient();
  const [{ data: actions }, { data: connectors }] = await Promise.all([
    sb
      .from('helpdesk_connector_actions')
      .select('id,connector_id,name,description,action_type,risk,required_fields,optional_fields,allowed_roles,needs_confirmation,is_enabled')
      .eq('company_id', companyId)
      .eq('is_enabled', true)
      .order('name', { ascending: true })
      .limit(100),
    sb
      .from('helpdesk_connectors')
      .select('id,name,platform,status')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(50),
  ]);

  const connectorById = new Map<string, { name: string; platform: string }>();
  for (const row of connectors ?? []) {
    const x = row as Record<string, unknown>;
    connectorById.set(x.id as string, {
      name: x.name as string,
      platform: x.platform as string,
    });
  }

  return (actions ?? [])
    .map((row) => {
      const x = row as Record<string, unknown>;
      const connector = connectorById.get(x.connector_id as string);
      if (!connector) return null;
      return {
        id: x.id as string,
        connectorId: x.connector_id as string,
        connectorName: connector.name,
        connectorPlatform: connector.platform,
        name: x.name as string,
        description: (x.description as string) ?? '',
        actionType: x.action_type as string,
        risk: x.risk as string,
        requiredFields: arr(x.required_fields),
        optionalFields: arr(x.optional_fields),
        allowedRoles: arr(x.allowed_roles),
        needsConfirmation: Boolean(x.needs_confirmation),
      } satisfies HelpdeskRuntimeAction;
    })
    .filter((x): x is HelpdeskRuntimeAction => x !== null);
}

export function formatHelpdeskActionCatalog(actions: HelpdeskRuntimeAction[]): string {
  if (!actions.length) return '';
  const lines = actions.map((action) => {
    const required = action.requiredFields.length ? action.requiredFields.join(', ') : 'none';
    const optional = action.optionalFields.length ? action.optionalFields.join(', ') : 'none';
    const roles = action.allowedRoles.length ? action.allowedRoles.join(', ') : 'not specified';
    const confirmation = action.needsConfirmation ? 'requires explicit user confirmation' : 'no confirmation required';
    return [
      `- ${action.name} (${action.actionType}, ${action.risk}) via ${action.connectorName} [${action.connectorPlatform}], connector_id=${action.connectorId}`,
      `  Description: ${action.description || 'No description.'}`,
      `  Required fields: ${required}. Optional fields: ${optional}. Roles: ${roles}. ${confirmation}.`,
    ].join('\n');
  });

  return [
    'AVAILABLE HELP DESK CONNECTOR ACTIONS',
    'Use run_helpdesk_action only for these approved actions. For update/create/high-risk actions, ask for clear confirmation first. Never invent an action name.',
    ...lines,
  ].join('\n');
}

async function waitForEventResult(companyId: string, eventId: string) {
  const sb = createSupabaseServiceClient();
  const deadline = Date.now() + HELP_DESK_ACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data } = await sb
      .from('helpdesk_connector_events')
      .select('status,response_json,error_message,completed_at')
      .eq('company_id', companyId)
      .eq('id', eventId)
      .maybeSingle();

    const status = (data?.status as string | undefined) ?? 'queued';
    if (status === 'completed') {
      return {
        status,
        response: data?.response_json ?? {},
        completedAt: (data?.completed_at as string | null) ?? null,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        status,
        error: (data?.error_message as string | null) ?? 'Connector action failed.',
        completedAt: (data?.completed_at as string | null) ?? null,
      };
    }

    await sleep(HELP_DESK_ACTION_POLL_MS);
  }

  return {
    status: 'queued',
    message: 'The connector accepted the request but has not returned a result yet.',
  };
}

export async function runHelpdeskConnectorAction(
  rawInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const parsed = runActionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_action_request', issues: parsed.error.issues };
  }

  const actions = await listEnabledHelpdeskActions(ctx.companyId);
  const matches = actions.filter(
    (action) =>
      action.name === parsed.data.action_name &&
      (!parsed.data.connector_id || action.connectorId === parsed.data.connector_id),
  );

  if (matches.length === 0) {
    return {
      ok: false,
      error: 'action_not_available',
      availableActions: actions.map((action) => ({
        action_name: action.name,
        connector_id: action.connectorId,
        connector: action.connectorName,
        description: action.description,
      })),
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      error: 'ambiguous_action',
      message: 'More than one active connector exposes this action. Choose the connector_id.',
      options: matches.map((action) => ({
        action_name: action.name,
        connector_id: action.connectorId,
        connector: action.connectorName,
        platform: action.connectorPlatform,
      })),
    };
  }

  const action = matches[0]!;
  const missingFields = action.requiredFields.filter((field) => {
    const value = parsed.data.input[field];
    return value == null || value === '';
  });
  if (missingFields.length) {
    return {
      ok: false,
      error: 'missing_required_fields',
      action_name: action.name,
      missingFields,
    };
  }

  const isWriteOrRisky =
    action.needsConfirmation ||
    action.actionType === 'create' ||
    action.actionType === 'update' ||
    action.actionType === 'danger' ||
    action.risk !== 'low';
  if (isWriteOrRisky && !parsed.data.confirmed) {
    return {
      ok: false,
      confirmationRequired: true,
      action_name: action.name,
      connector: action.connectorName,
      risk: action.risk,
      actionType: action.actionType,
      message:
        'Ask the user to confirm this exact change before calling this action again with confirmed=true.',
      input: parsed.data.input,
    };
  }

  const sb = createSupabaseServiceClient();
  const { data: event, error } = await sb
    .from('helpdesk_connector_events')
    .insert({
      company_id: ctx.companyId,
      connector_id: action.connectorId,
      action_id: action.id,
      event_name: action.name,
      request_json: {
        ...parsed.data.input,
        _botId: ctx.botId,
        _conversationId: ctx.conversationId,
      },
      status: 'queued',
    })
    .select('id')
    .single();

  if (error || !event) {
    return { ok: false, error: error?.message ?? 'Could not queue connector action.' };
  }

  return {
    ok: true,
    action_name: action.name,
    connector: action.connectorName,
    eventId: event.id,
    ...(await waitForEventResult(ctx.companyId, event.id as string)),
  };
}
