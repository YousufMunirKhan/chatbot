'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { ingestText } from '@/lib/ai/ingest';
import { createConnectorToken, hashConnectorToken, requestConnectorResync } from '@/lib/helpdesk/connectors';
import { getCompanyId } from './data';
import type { ActionState } from './actions';

export type ConnectorActionState = ActionState & { token?: string; connectorName?: string };

const connectorSchema = z.object({
  name: z.string().min(2, 'Connector name is required').max(80),
  platform: z.enum(['dotnet', 'android', 'web']),
});

export async function createHelpdeskConnectorAction(
  _prev: ConnectorActionState,
  formData: FormData,
): Promise<ConnectorActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = connectorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid connector' };

  const token = createConnectorToken();
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('helpdesk_connectors').insert({
    company_id: companyId,
    name: parsed.data.name,
    platform: parsed.data.platform,
    token_hash: hashConnectorToken(token),
    status: 'active',
  });
  if (error) return { error: error.message };

  revalidatePath('/company/help-desk');
  return { ok: true, token, connectorName: parsed.data.name };
}

const stockSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  confirm: z.literal('on', { errorMap: () => ({ message: 'Confirm the stock change before saving.' }) }),
});

export async function updateLocalStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = stockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid stock update' };

  const sb = createSupabaseServiceClient();
  const { data: product } = await sb
    .from('synced_products')
    .select('id,title')
    .eq('company_id', companyId)
    .eq('id', parsed.data.productId)
    .maybeSingle();
  if (!product) return { error: 'Product not found.' };

  const { data: existingInventory } = await sb
    .from('synced_inventory')
    .select('id,quantity')
    .eq('company_id', companyId)
    .eq('product_id', parsed.data.productId)
    .limit(1)
    .maybeSingle();

  const nextQuantity = parsed.data.quantity;
  const payload = {
    quantity: nextQuantity,
    in_stock: nextQuantity > 0,
    updated_at: new Date().toISOString(),
  };

  const { error } = existingInventory
    ? await sb.from('synced_inventory').update(payload).eq('id', existingInventory.id).eq('company_id', companyId)
    : await sb.from('synced_inventory').insert({
        company_id: companyId,
        product_id: parsed.data.productId,
        ...payload,
      });

  if (error) return { error: error.message };

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: user.userId,
    action: 'helpdesk.stock_update',
    target_type: 'synced_product',
    target_id: parsed.data.productId,
    metadata_json: {
      productTitle: (product as { title?: string }).title ?? null,
      previousQuantity: (existingInventory as { quantity?: number } | null)?.quantity ?? null,
      nextQuantity,
      note: 'Local synced inventory updated. External writeback requires provider-specific integration support.',
    },
  });

  revalidatePath('/company/help-desk');
  revalidatePath('/company/business-data');
  return { ok: true };
}

const documentSchema = z.object({ documentId: z.string().uuid() });

export async function approveConnectorDocumentAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = documentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();

  const { data: doc } = await sb
    .from('helpdesk_connector_documents')
    .select('id,connector_id,module,screen,path,content,status')
    .eq('company_id', companyId)
    .eq('id', parsed.data.documentId)
    .maybeSingle();
  if (!doc || doc.status === 'approved') return;

  await ingestText({
    companyId,
    botId: null,
    title: `${doc.module} - ${doc.screen}`,
    text: doc.content,
    sourceType: 'text',
  });

  await sb
    .from('helpdesk_connector_documents')
    .update({
      status: 'approved',
      reviewed_by: user.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.documentId);

  await sb.from('audit_logs').insert({
    company_id: companyId,
    actor_user_id: user.userId,
    action: 'helpdesk.connector_doc_approved',
    target_type: 'helpdesk_connector_document',
    target_id: parsed.data.documentId,
    metadata_json: {
      module: doc.module,
      screen: doc.screen,
      note: 'Approved connector documentation was indexed into knowledge.',
    },
  });

  revalidatePath('/company/help-desk');
  revalidatePath('/company/knowledge');
  revalidatePath('/company/business-data');
  revalidatePath('/company/setup');
}

export async function rejectConnectorDocumentAction(formData: FormData): Promise<void> {
  const user = await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = documentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  const { data: doc } = await sb
    .from('helpdesk_connector_documents')
    .select('connector_id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.documentId)
    .maybeSingle();
  if (!doc) return;

  await sb
    .from('helpdesk_connector_documents')
    .update({
      status: 'rejected',
      reviewed_by: user.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', parsed.data.documentId);

  await requestConnectorResync({
    companyId,
    connectorId: doc.connector_id as string,
    reason: 'A connector document was rejected.',
  });
  revalidatePath('/company/help-desk');
}

const actionToggleSchema = z.object({
  actionId: z.string().uuid(),
  enabled: z.preprocess((value) => value === 'on', z.boolean()),
});

export async function setConnectorActionEnabledAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = actionToggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  const { data: action } = await sb
    .from('helpdesk_connector_actions')
    .select('connector_id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.actionId)
    .maybeSingle();

  await sb
    .from('helpdesk_connector_actions')
    .update({ is_enabled: parsed.data.enabled })
    .eq('company_id', companyId)
    .eq('id', parsed.data.actionId)
    .neq('action_type', 'danger');
  if (action?.connector_id) {
    await requestConnectorResync({
      companyId,
      connectorId: action.connector_id as string,
      reason: 'An action was enabled or disabled in the dashboard.',
    });
  }
  revalidatePath('/company/help-desk');
}

const connectorResyncSchema = z.object({ connectorId: z.string().uuid() });

export async function requestConnectorResyncAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = connectorResyncSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  await requestConnectorResync({
    companyId,
    connectorId: parsed.data.connectorId,
    reason: 'Manual resync requested from dashboard.',
  });
  revalidatePath('/company/help-desk');
}

const queueEventSchema = z.object({
  actionId: z.string().uuid(),
  requestJson: z.string().max(4000).default('{}'),
});

export async function queueConnectorEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = queueEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid event' };

  let request: Record<string, unknown>;
  try {
    request = JSON.parse(parsed.data.requestJson || '{}') as Record<string, unknown>;
  } catch {
    return { error: 'Request JSON is invalid.' };
  }

  const sb = createSupabaseServiceClient();
  const { data: action } = await sb
    .from('helpdesk_connector_actions')
    .select('id,connector_id,name,is_enabled')
    .eq('company_id', companyId)
    .eq('id', parsed.data.actionId)
    .maybeSingle();
  if (!action || !action.is_enabled) return { error: 'Action is not enabled.' };

  const { error } = await sb.from('helpdesk_connector_events').insert({
    company_id: companyId,
    connector_id: action.connector_id,
    action_id: action.id,
    event_name: action.name,
    request_json: request,
    status: 'queued',
  });
  if (error) return { error: error.message };

  revalidatePath('/company/help-desk');
  return { ok: true };
}
