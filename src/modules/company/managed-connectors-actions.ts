'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { createConnectorToken, hashConnectorToken } from '@/lib/helpdesk/connectors';
import {
  MANAGED_ACTION_DEFS,
  MANAGED_CREDENTIAL_FIELDS,
  type ManagedPlatform,
} from '@/lib/helpdesk/managed';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const PLATFORMS: ManagedPlatform[] = ['shopify', 'square', 'foodics'];

export async function createManagedConnectorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const platform = String(formData.get('platform') ?? '') as ManagedPlatform;
  if (!PLATFORMS.includes(platform)) return { error: 'Choose a platform.' };

  // Collect + validate the platform's credential fields.
  const creds: Record<string, string> = {};
  for (const field of MANAGED_CREDENTIAL_FIELDS[platform]) {
    const value = String(formData.get(field.key) ?? '').trim();
    if (field.required && !value) return { error: `${field.label} is required.` };
    if (value) creds[field.key] = value;
  }

  const sb = createSupabaseServiceClient();

  // Back the managed connector with a normal helpdesk_connectors row (platform
  // 'web' satisfies the column constraint; the real platform lives below).
  const token = createConnectorToken();
  const { data: connector, error: connErr } = await sb
    .from('helpdesk_connectors')
    .insert({
      company_id: companyId,
      name: `${platform[0]!.toUpperCase()}${platform.slice(1)} (managed)`,
      platform: 'web',
      token_hash: hashConnectorToken(token),
      status: 'active',
    })
    .select('id')
    .single();
  if (connErr || !connector) return { error: connErr?.message ?? 'Could not create connector.' };
  const connectorId = connector.id as string;

  const { error: mcErr } = await sb.from('managed_connectors').insert({
    company_id: companyId,
    connector_id: connectorId,
    platform,
    credentials_encrypted: encryptSecret(JSON.stringify(creds)),
    status: 'active',
  });
  if (mcErr) {
    await sb.from('helpdesk_connectors').delete().eq('company_id', companyId).eq('id', connectorId);
    return { error: mcErr.message };
  }

  // Auto-enable the platform's read actions so the bot can use them immediately.
  const actionRows = MANAGED_ACTION_DEFS[platform].map((a) => ({
    company_id: companyId,
    connector_id: connectorId,
    name: a.name,
    description: a.description,
    action_type: a.actionType,
    risk: a.risk,
    required_fields: a.requiredFields,
    optional_fields: a.optionalFields,
    allowed_roles: ['admin', 'manager', 'staff'],
    needs_confirmation: false,
    is_enabled: true,
  }));
  await sb.from('helpdesk_connector_actions').insert(actionRows);

  revalidatePath('/company/managed-connectors');
  revalidatePath('/company/help-desk');
  return { ok: true };
}

export async function deleteManagedConnectorAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const connectorId = z.string().uuid().safeParse(formData.get('connectorId'));
  if (!connectorId.success) return;
  const sb = createSupabaseServiceClient();
  // Deleting the connector cascades managed_connectors + actions + events.
  await sb.from('helpdesk_connectors').delete().eq('company_id', companyId).eq('id', connectorId.data);
  revalidatePath('/company/managed-connectors');
  revalidatePath('/company/help-desk');
}
