import crypto from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';

export const CONNECTOR_TOKEN_PREFIX = 'hdk_';
export const DELIVERY_MODES = ['direct_api', 'websocket', 'polling_fallback', 'manual'] as const;
export type ConnectorDeliveryMode = (typeof DELIVERY_MODES)[number];

const deliveryModeSchema = z.enum(DELIVERY_MODES);

const stringArray = z.array(z.string().min(1).max(120)).max(50).default([]);

const navigationSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    routeId: z.string().min(1).max(160).optional(),
    platformTargets: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const connectorDocumentSchema = z.object({
  externalKey: z.string().min(1).max(240),
  module: z.string().min(1).max(120),
  screen: z.string().min(1).max(120),
  path: z.string().max(240).optional(),
  purpose: z.string().max(1000).optional(),
  steps: z.array(z.string().min(1).max(500)).max(40).default([]),
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        required: z.boolean().default(false),
        description: z.string().max(300).optional(),
      }),
    )
    .max(80)
    .default([]),
  commonErrors: z.array(z.string().min(1).max(500)).max(40).default([]),
  actions: stringArray,
  navigation: navigationSchema.optional(),
  needsReview: z.boolean().default(false),
  content: z.string().max(12000).optional(),
});

export const connectorActionSchema = z.object({
  name: z.string().min(2).max(120).regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().max(1000).default(''),
  type: z.enum(['read', 'report', 'create', 'update', 'danger']).default('read'),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  requiredFields: stringArray,
  optionalFields: stringArray,
  allowedRoles: stringArray,
  needsConfirmation: z.boolean().default(false),
});

export const connectorSyncSchema = z.object({
  appVersion: z.string().max(80).optional(),
  clientRevision: z.coerce.number().int().min(0).optional(),
  documents: z.array(connectorDocumentSchema).max(200).default([]),
  actions: z.array(connectorActionSchema).max(120).default([]),
});

export const eventResultSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  response: z.record(z.unknown()).optional(),
  error: z.string().max(2000).optional(),
  deliveryMode: deliveryModeSchema.default('polling_fallback'),
  durationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
});

export const connectorHealthSchema = z.object({
  eventType: z.string().min(2).max(120).regex(/^[a-z][a-z0-9_]*$/),
  deliveryMode: deliveryModeSchema.default('polling_fallback'),
  status: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  message: z.string().max(1000).optional(),
  eventId: z.string().uuid().optional(),
  actionName: z.string().min(2).max(120).optional(),
  durationMs: z.coerce.number().int().min(0).max(3_600_000).optional(),
  pollIntervalSeconds: z.coerce.number().int().min(5).max(86_400).optional(),
  eventsReturned: z.coerce.number().int().min(0).max(1000).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type ConnectorSyncPayload = z.infer<typeof connectorSyncSchema>;

export interface AuthenticatedConnector {
  id: string;
  companyId: string;
  platform: 'dotnet' | 'android' | 'web' | 'other';
  name: string;
  status: string;
  manifestRevision: number;
  lastSyncAt: string | null;
  resyncRequestedAt: string | null;
  preferredDeliveryMode: ConnectorDeliveryMode;
  activeDeliveryMode: ConnectorDeliveryMode;
  connectionState: string;
  pollIntervalSeconds: number;
  fallbackReason: string | null;
}

export function createConnectorToken(): string {
  return `${CONNECTOR_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashConnectorToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateHelpdeskConnector(req: Request): Promise<AuthenticatedConnector | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('helpdesk_connectors')
    .select(
      'id,company_id,platform,name,status,manifest_revision,last_sync_at,resync_requested_at,preferred_delivery_mode,active_delivery_mode,connection_state,poll_interval_seconds,fallback_reason',
    )
    .eq('token_hash', hashConnectorToken(token))
    .maybeSingle();
  if (error || !data || data.status !== 'active') return null;
  await sb
    .from('helpdesk_connectors')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', data.id);
  return {
    id: data.id as string,
    companyId: data.company_id as string,
    platform: data.platform as AuthenticatedConnector['platform'],
    name: data.name as string,
    status: data.status as string,
    manifestRevision: Number(data.manifest_revision ?? 1),
    lastSyncAt: (data.last_sync_at as string | null) ?? null,
    resyncRequestedAt: (data.resync_requested_at as string | null) ?? null,
    preferredDeliveryMode: (data.preferred_delivery_mode as ConnectorDeliveryMode | null) ?? 'websocket',
    activeDeliveryMode: (data.active_delivery_mode as ConnectorDeliveryMode | null) ?? 'polling_fallback',
    connectionState: (data.connection_state as string | null) ?? 'unknown',
    pollIntervalSeconds: Number(data.poll_interval_seconds ?? 60),
    fallbackReason: (data.fallback_reason as string | null) ?? null,
  };
}

export function connectorNeedsSync(connector: Pick<AuthenticatedConnector, 'lastSyncAt' | 'resyncRequestedAt'>): boolean {
  if (!connector.lastSyncAt) return true;
  if (!connector.resyncRequestedAt) return false;
  return new Date(connector.resyncRequestedAt).getTime() > new Date(connector.lastSyncAt).getTime();
}

export function connectorStatusPayload(connector: AuthenticatedConnector) {
  const syncRequired = connectorNeedsSync(connector);
  return {
    manifestRevision: connector.manifestRevision,
    syncRequired,
    delivery: {
      preferredMode: connector.preferredDeliveryMode,
      activeMode: connector.activeDeliveryMode,
      connectionState: connector.connectionState,
      pollIntervalSeconds: connector.pollIntervalSeconds,
      fallbackReason: connector.fallbackReason,
      websocketAvailable: false,
      fallbackPollingAvailable: true,
    },
    commands: syncRequired
      ? [
          {
            type: 'resync_manifest',
            reason: connector.lastSyncAt
              ? 'Dashboard connector configuration changed.'
              : 'Connector has not synced its manifest yet.',
          },
        ]
      : [],
  };
}

export async function logConnectorHealth(
  connector: Pick<AuthenticatedConnector, 'id' | 'companyId'>,
  input: z.input<typeof connectorHealthSchema>,
): Promise<void> {
  const parsed = connectorHealthSchema.parse(input);
  const sb = createSupabaseServiceClient();
  await sb.from('helpdesk_connector_health_logs').insert({
    company_id: connector.companyId,
    connector_id: connector.id,
    event_type: parsed.eventType,
    delivery_mode: parsed.deliveryMode,
    status: parsed.status,
    message: parsed.message ?? null,
    event_id: parsed.eventId ?? null,
    action_name: parsed.actionName ?? null,
    duration_ms: parsed.durationMs ?? null,
    poll_interval_seconds: parsed.pollIntervalSeconds ?? null,
    events_returned: parsed.eventsReturned ?? null,
    metadata_json: parsed.metadata ?? {},
  });
}

export async function updateConnectorDeliveryState(
  connector: Pick<AuthenticatedConnector, 'id' | 'companyId'>,
  params: {
    activeDeliveryMode?: ConnectorDeliveryMode;
    connectionState?: 'unknown' | 'connected' | 'degraded' | 'fallback' | 'offline';
    pollIntervalSeconds?: number;
    fallbackReason?: string | null;
    lastConnectedAt?: string | null;
    lastDisconnectedAt?: string | null;
    lastPollAt?: string | null;
    lastError?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    last_health_at: new Date().toISOString(),
  };
  if (params.activeDeliveryMode) update.active_delivery_mode = params.activeDeliveryMode;
  if (params.connectionState) update.connection_state = params.connectionState;
  if (params.pollIntervalSeconds != null) update.poll_interval_seconds = params.pollIntervalSeconds;
  if ('fallbackReason' in params) update.fallback_reason = params.fallbackReason;
  if ('lastConnectedAt' in params) update.last_connected_at = params.lastConnectedAt;
  if ('lastDisconnectedAt' in params) update.last_disconnected_at = params.lastDisconnectedAt;
  if ('lastPollAt' in params) update.last_poll_at = params.lastPollAt;
  if ('lastError' in params) update.last_error = params.lastError;

  const sb = createSupabaseServiceClient();
  await sb
    .from('helpdesk_connectors')
    .update(update)
    .eq('company_id', connector.companyId)
    .eq('id', connector.id);
}

export async function requestConnectorResync(params: {
  connectorId: string;
  companyId: string;
  reason: string;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('helpdesk_connectors')
    .select('manifest_revision,settings_json')
    .eq('company_id', params.companyId)
    .eq('id', params.connectorId)
    .maybeSingle();
  if (!data) return;

  const settings =
    data.settings_json && typeof data.settings_json === 'object' && !Array.isArray(data.settings_json)
      ? (data.settings_json as Record<string, unknown>)
      : {};

  await sb
    .from('helpdesk_connectors')
    .update({
      manifest_revision: Number(data.manifest_revision ?? 1) + 1,
      resync_requested_at: new Date().toISOString(),
      settings_json: {
        ...settings,
        lastResyncReason: params.reason,
      },
    })
    .eq('company_id', params.companyId)
    .eq('id', params.connectorId);
}

function bulletList(items: string[]): string {
  return items.length ? items.map((item, index) => `${index + 1}. ${item}`).join('\n') : 'Not provided.';
}

function fieldList(fields: z.infer<typeof connectorDocumentSchema>['fields']): string {
  if (!fields.length) return 'Not provided.';
  return fields
    .map((field) => {
      const required = field.required ? 'required' : 'optional';
      const description = field.description ? ` - ${field.description}` : '';
      return `- ${field.name} (${required})${description}`;
    })
    .join('\n');
}

function navigationText(nav: z.infer<typeof connectorDocumentSchema>['navigation']): string {
  if (!nav) return 'Not provided.';
  const parts = [
    nav.label ? `Button label: ${nav.label}` : null,
    nav.routeId ? `Route ID: ${nav.routeId}` : null,
  ].filter(Boolean);
  if (nav.platformTargets && typeof nav.platformTargets === 'object') {
    parts.push(`Platform targets: ${JSON.stringify(nav.platformTargets)}`);
  }
  return parts.length ? parts.join('\n') : 'Not provided.';
}

function titleFromKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function keywordsFor(...values: Array<string | null | undefined>): string[] {
  const words = new Set<string>();
  for (const value of values) {
    for (const part of String(value ?? '').split(/[^a-zA-Z0-9]+/)) {
      const word = part.trim().toLowerCase();
      if (word.length >= 3) words.add(word);
    }
  }
  return [...words].slice(0, 16);
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildConnectorDocumentContent(doc: z.infer<typeof connectorDocumentSchema>): string {
  if (doc.content?.trim()) return doc.content.trim();
  return [
    `Module: ${doc.module}`,
    `Screen: ${doc.screen}`,
    `Menu path: ${doc.path?.trim() || 'Not provided.'}`,
    '',
    'Purpose:',
    doc.purpose?.trim() || 'Not provided.',
    '',
    'Steps:',
    bulletList(doc.steps),
    '',
    'Fields:',
    fieldList(doc.fields),
    '',
    'Common errors:',
    bulletList(doc.commonErrors),
    '',
    'Related actions:',
    doc.actions.length ? doc.actions.map((action) => `- ${action}`).join('\n') : 'Not provided.',
    '',
    'Navigation:',
    navigationText(doc.navigation),
    '',
    'Review status:',
    doc.needsReview ? 'Needs developer/admin review.' : 'Ready for admin review.',
  ].join('\n');
}

export async function syncConnectorPayload(
  connector: AuthenticatedConnector,
  payload: ConnectorSyncPayload,
) {
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();

  if (payload.documents.length) {
    const keys = payload.documents.map((doc) => doc.externalKey);
    const { data: existingDocs } = await sb
      .from('helpdesk_connector_documents')
      .select('external_key,status,source_json,content,reviewed_by,reviewed_at,ignored_at')
      .eq('company_id', connector.companyId)
      .eq('connector_id', connector.id)
      .in('external_key', keys);
    const existingByKey = new Map(
      ((existingDocs ?? []) as Array<Record<string, unknown>>).map((row) => [row.external_key as string, row]),
    );

    const docs = payload.documents.map((doc) => {
      const content = buildConnectorDocumentContent(doc);
      const existing = existingByKey.get(doc.externalKey);
      const previousHash = existing ? stableHash({ source: existing.source_json, content: existing.content }) : null;
      const nextHash = stableHash({ source: doc, content });
      const changed = !existing || previousHash !== nextHash;
      const currentStatus = String(existing?.status ?? 'draft');
      return {
        company_id: connector.companyId,
        connector_id: connector.id,
        external_key: doc.externalKey,
        status: changed ? 'draft' : currentStatus,
        platform: connector.platform,
        module: doc.module,
        screen: doc.screen,
        path: doc.path ?? null,
        purpose: doc.purpose ?? null,
        content,
        source_json: doc,
        previous_source_json: changed && existing ? existing.source_json : null,
        change_type: existing ? (changed ? 'updated' : 'unchanged') : 'new',
        reviewed_by: changed ? null : existing?.reviewed_by ?? null,
        reviewed_at: changed ? null : existing?.reviewed_at ?? null,
        ignored_at: changed ? null : existing?.ignored_at ?? null,
      };
    });
    const { error } = await sb
      .from('helpdesk_connector_documents')
      .upsert(docs, { onConflict: 'connector_id,external_key' });
    if (error) throw error;
  }

  if (payload.actions.length) {
    const names = payload.actions.map((action) => action.name);
    const { data: existingActions } = await sb
      .from('helpdesk_connector_actions')
      .select('name,is_enabled,needs_confirmation,admin_label,admin_note')
      .eq('company_id', connector.companyId)
      .eq('connector_id', connector.id)
      .in('name', names);
    const existingByName = new Map(
      ((existingActions ?? []) as Array<Record<string, unknown>>).map((row) => [row.name as string, row]),
    );

    const actions = payload.actions.map((action) => {
      const existing = existingByName.get(action.name);
      const writeOrRisky = action.risk !== 'low' || action.type === 'create' || action.type === 'update' || action.type === 'danger';
      return {
        company_id: connector.companyId,
        connector_id: connector.id,
        name: action.name,
        description: action.description,
        action_type: action.type,
        risk: action.risk,
        required_fields: action.requiredFields,
        optional_fields: action.optionalFields,
        allowed_roles: action.allowedRoles,
        needs_confirmation: writeOrRisky ? true : existing?.needs_confirmation ?? action.needsConfirmation,
        is_enabled: existing ? Boolean(existing.is_enabled) : action.type !== 'danger',
        admin_label: existing?.admin_label ?? null,
        admin_note: existing?.admin_note ?? null,
        schema_json: action,
      };
    });
    const { error } = await sb
      .from('helpdesk_connector_actions')
      .upsert(actions, { onConflict: 'connector_id,name' });
    if (error) throw error;
  }

  await syncConnectorGeneratedQuickActions(connector);

  await sb
    .from('helpdesk_connectors')
    .update({
      app_version: payload.appVersion ?? null,
      last_client_revision: payload.clientRevision ?? connector.manifestRevision,
      last_sync_at: now,
      last_seen_at: now,
      resync_requested_at: null,
    })
    .eq('id', connector.id);

  return {
    documentsReceived: payload.documents.length,
    actionsReceived: payload.actions.length,
    manifestRevision: connector.manifestRevision,
  };
}

type ConnectorQuickActionDraft = {
  connectorKey: string;
  row: Record<string, unknown> & { priority: number };
};

async function syncConnectorGeneratedQuickActions(connector: AuthenticatedConnector): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data: bots } = await sb
    .from('bots')
    .select('id,appearance_json,bot_type,capability_flags')
    .eq('company_id', connector.companyId);

  const internalBots = ((bots ?? []) as Array<Record<string, unknown>>).filter((bot) => {
    const appearance = (bot.appearance_json as Record<string, unknown> | null) ?? {};
    const caps = Array.isArray(bot.capability_flags) ? (bot.capability_flags as string[]) : [];
    return (
      appearance.assistantAudience === 'internal' ||
      bot.bot_type === 'help_desk' ||
      caps.some((cap) => cap.startsWith('internal_'))
    );
  });
  if (internalBots.length === 0) return;

  const [{ data: docs }, { data: actions }] = await Promise.all([
    sb
      .from('helpdesk_connector_documents')
      .select('id,module,screen,path,purpose,source_json')
      .eq('company_id', connector.companyId)
      .eq('connector_id', connector.id)
      .limit(80),
    sb
      .from('helpdesk_connector_actions')
      .select('id,name,description,action_type,risk,needs_confirmation,is_enabled')
      .eq('company_id', connector.companyId)
      .eq('connector_id', connector.id)
      .eq('is_enabled', true)
      .limit(80),
  ]);

  for (const bot of internalBots) {
    const botId = bot.id as string;
    const { data: existing } = await sb
      .from('bot_quick_actions')
      .select('id,connector_document_id,connector_action_id,action_config_json,is_active,priority')
      .eq('company_id', connector.companyId)
      .eq('bot_id', botId)
      .eq('source', 'connector');

    const existingByKey = new Map<string, Record<string, unknown>>();
    for (const row of (existing ?? []) as Array<Record<string, unknown>>) {
      const config = (row.action_config_json as Record<string, unknown> | null) ?? {};
      const key = typeof config.connectorKey === 'string' ? config.connectorKey : null;
      if (key) existingByKey.set(key, row);
    }

    const desired: ConnectorQuickActionDraft[] = [];
    for (const doc of (docs ?? []) as Array<Record<string, unknown>>) {
      const source = (doc.source_json as Record<string, unknown> | null) ?? {};
      const nav = (source.navigation as Record<string, unknown> | null) ?? null;
      const screen = String(doc.screen ?? 'screen');
      const path = String(doc.path ?? screen);
      const routeId = typeof nav?.routeId === 'string' ? nav.routeId : null;
      const docId = doc.id as string;
      desired.push({
        connectorKey: `doc:${docId}:howto`,
        row: {
          company_id: connector.companyId,
          bot_id: botId,
          label: `How to ${screen}`,
          description: String(doc.purpose ?? `Show the steps for ${path}.`).slice(0, 240),
          action_type: 'send_message',
          action_config_json: {
            connectorKey: `doc:${docId}:howto`,
            message_text: `How do I use ${path}?`,
            connectorDocumentId: docId,
          },
          form_schema_json: [],
          contexts: ['initial', 'contextual', 'after_answer'],
          keyword_triggers: keywordsFor(doc.module as string, screen, path, doc.purpose as string),
          required_capabilities: [],
          business_hours_mode: 'any',
          conversation_statuses: [],
          priority: 200,
          is_active: true,
          starts_new_message: true,
          audience: 'internal',
          source: 'connector',
          context_mode: 'contextual',
          connector_document_id: docId,
          connector_action_id: null,
        },
      });
      if (routeId) {
        desired.push({
          connectorKey: `doc:${docId}:open`,
          row: {
            company_id: connector.companyId,
            bot_id: botId,
            label: `Open ${screen}`,
            description: `Open ${path} in the connected software when supported.`,
            action_type: 'tool_action',
            action_config_json: {
              connectorKey: `doc:${docId}:open`,
              tool: 'helpdesk_navigation',
              routeId,
              message_text: `Open ${screen}`,
              connectorDocumentId: docId,
            },
            form_schema_json: [],
            contexts: ['initial', 'contextual', 'after_answer'],
            keyword_triggers: keywordsFor('open', doc.module as string, screen, path, routeId),
            required_capabilities: [],
            business_hours_mode: 'any',
            conversation_statuses: [],
            priority: 210,
            is_active: true,
            starts_new_message: true,
            audience: 'internal',
            source: 'connector',
            context_mode: 'navigation',
            connector_document_id: docId,
            connector_action_id: null,
          },
        });
      }
    }

    for (const action of (actions ?? []) as Array<Record<string, unknown>>) {
      const name = action.name as string;
      const actionId = action.id as string;
      const label = titleFromKey(name);
      const type = String(action.action_type ?? 'read');
      const writeLike = ['create', 'update', 'danger'].includes(type);
      desired.push({
        connectorKey: `action:${actionId}`,
        row: {
          company_id: connector.companyId,
          bot_id: botId,
          label,
          description: String(action.description ?? `Start ${label}.`).slice(0, 240),
          action_type: 'send_message',
          action_config_json: {
            connectorKey: `action:${actionId}`,
            message_text: writeLike ? `I want to ${label.toLowerCase()}` : label,
            connectorActionId: actionId,
            actionName: name,
            needsConfirmation: Boolean(action.needs_confirmation) || writeLike,
          },
          form_schema_json: [],
          contexts: ['initial', 'contextual', 'after_answer'],
          keyword_triggers: keywordsFor(name, label, action.description as string),
          required_capabilities: [],
          business_hours_mode: 'any',
          conversation_statuses: [],
          priority: writeLike ? 240 : 220,
          is_active: true,
          starts_new_message: true,
          audience: 'internal',
          source: 'connector',
          context_mode: 'action',
          connector_document_id: null,
          connector_action_id: actionId,
        },
      });
    }

    for (const item of desired.slice(0, 80)) {
      const current = existingByKey.get(item.connectorKey);
      if (current?.id) {
        await sb
          .from('bot_quick_actions')
          .update({
            ...item.row,
            is_active: current.is_active,
            priority: current.priority ?? item.row.priority,
          })
          .eq('company_id', connector.companyId)
          .eq('bot_id', botId)
          .eq('id', current.id as string);
      } else {
        await sb.from('bot_quick_actions').insert(item.row);
      }
    }
  }
}
