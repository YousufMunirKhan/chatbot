'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { importCsv } from '@/lib/integrations/csv';
import { runSync } from '@/lib/integrations/sync';
import { encryptSecret } from '@/lib/crypto';
import { assertWithinPlan } from '@/lib/billing';
import { getCompanyId } from './data';
import type { ActionState } from './actions';

// ---------------------------------------------------------------------------
// CSV import (Module 14 → Catalog)
// ---------------------------------------------------------------------------
const csvSchema = z.object({
  entity: z.enum(['products', 'orders', 'customers', 'inventory', 'menu']),
  csv: z.string().min(5, 'Paste at least a header row and one line of data'),
});

export async function importCsvAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = csvSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { entity, csv } = parsed.data;
  try {
    await importCsv(companyId, entity, csv);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath('/company/integrations');
  revalidatePath('/company/catalog');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Connect an integration account
// ---------------------------------------------------------------------------
const connectSchema = z.object({
  provider: z.enum(['woocommerce', 'shopify', 'custom_api', 'google_calendar']),
  name: z.string().min(2, 'Give this connection a name'),
});

export async function connectIntegrationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { provider, name } = parsed.data;

  // Collect every non-empty form entry except provider/name into the creds blob.
  const creds: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'provider' || key === 'name') continue;
    if (typeof value === 'string' && value.trim()) creds[key] = value.trim();
  }

  try {
    await assertWithinPlan(companyId, 'create_integration');
  } catch (e) {
    return { error: (e as Error).message };
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from('integration_accounts').insert({
    company_id: companyId,
    provider,
    name,
    status: 'connected',
    credentials_encrypted: encryptSecret(JSON.stringify(creds)),
    settings_json: {},
  });
  if (error) return { error: error.message };

  revalidatePath('/company/integrations');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resync / disconnect an integration account
// ---------------------------------------------------------------------------
const accountSchema = z.object({ accountId: z.string().uuid() });

export async function resyncAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();

  // Verify the account belongs to this company before triggering a sync.
  const { data: account } = await sb
    .from('integration_accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', parsed.data.accountId)
    .maybeSingle();
  if (!account) return;

  await runSync(parsed.data.accountId);
  revalidatePath('/company/integrations');
  revalidatePath('/company/catalog');
}

export async function disconnectAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();

  await sb
    .from('integration_accounts')
    .update({ status: 'disconnected' })
    .eq('company_id', companyId) // scope guard
    .eq('id', parsed.data.accountId);
  revalidatePath('/company/integrations');
}
