import crypto from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/db/server';

export const CONNECTOR_TOKEN_PREFIX = 'hdk_';

const stringArray = z.array(z.string().min(1).max(120)).max(50).default([]);

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
    .select('id,company_id,platform,name,status,manifest_revision,last_sync_at,resync_requested_at')
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
  ].join('\n');
}

export async function syncConnectorPayload(
  connector: AuthenticatedConnector,
  payload: ConnectorSyncPayload,
) {
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();

  if (payload.documents.length) {
    const docs = payload.documents.map((doc) => ({
      company_id: connector.companyId,
      connector_id: connector.id,
      external_key: doc.externalKey,
      status: 'draft',
      platform: connector.platform,
      module: doc.module,
      screen: doc.screen,
      path: doc.path ?? null,
      purpose: doc.purpose ?? null,
      content: buildConnectorDocumentContent(doc),
      source_json: doc,
      reviewed_by: null,
      reviewed_at: null,
    }));
    const { error } = await sb
      .from('helpdesk_connector_documents')
      .upsert(docs, { onConflict: 'connector_id,external_key' });
    if (error) throw error;
  }

  if (payload.actions.length) {
    const actions = payload.actions.map((action) => ({
      company_id: connector.companyId,
      connector_id: connector.id,
      name: action.name,
      description: action.description,
      action_type: action.type,
      risk: action.risk,
      required_fields: action.requiredFields,
      optional_fields: action.optionalFields,
      allowed_roles: action.allowedRoles,
      needs_confirmation: action.needsConfirmation || action.risk !== 'low' || action.type !== 'read',
      is_enabled: action.type !== 'danger',
      schema_json: action,
    }));
    const { error } = await sb
      .from('helpdesk_connector_actions')
      .upsert(actions, { onConflict: 'connector_id,name' });
    if (error) throw error;
  }

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
