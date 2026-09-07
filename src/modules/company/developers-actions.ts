'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole, getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { API_SCOPE_WILDCARD, generateApiKey, isApiScope } from '@/lib/api-keys';
import { sendTestEvent } from '@/lib/api/developer-events';
import { getCompanyId } from './data';
import { companyHasFeature, requireCompanyFeature } from '@/lib/entitlements';

const PATH = '/company/developers';

export type ActionState = { error?: string; ok?: boolean };

/**
 * `key` is the ONLY time the plaintext leaves the server. It lives in the
 * action result (never in the database, never in a log) so the console can show
 * it once and the user can copy it.
 */
export type CreateKeyState = ActionState & { key?: string; keyName?: string };

/** Bounded so one company cannot fill the table with keys. */
const MAX_KEYS_PER_COMPANY = 20;

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name so you can recognise it later')
    .max(80, 'Name is too long'),
  expiresInDays: z.enum(['never', '30', '90', '365']).default('never'),
});

export async function createApiKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('api_access'))) {
    return { error: 'Your plan does not include API access. See Billing to change your package.' };
  }
  const companyId = await getCompanyId();
  const user = await getSessionUser();

  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    expiresInDays: formData.get('expiresInDays') ?? 'never',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid key' };

  // Scope picker: an explicit list, or the wildcard when "full access" is ticked.
  const fullAccess = formData.get('fullAccess') === 'on';
  const scopes = fullAccess
    ? [API_SCOPE_WILDCARD]
    : formData.getAll('scopes').map(String).filter(isApiScope);
  if (scopes.length === 0) {
    return { error: 'Choose at least one scope, or tick full access.' };
  }

  const sb = createSupabaseServiceClient();
  const { count } = await sb
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('revoked_at', null);
  if ((count ?? 0) >= MAX_KEYS_PER_COMPANY) {
    return { error: `You can hold up to ${MAX_KEYS_PER_COMPANY} live keys. Revoke one first.` };
  }

  let expiresAt: string | null = null;
  if (parsed.data.expiresInDays !== 'never') {
    const days = Number(parsed.data.expiresInDays);
    expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  }

  const generated = generateApiKey();
  const { error } = await sb.from('api_keys').insert({
    company_id: companyId,
    name: parsed.data.name,
    key_prefix: generated.keyPrefix,
    key_hash: generated.keyHash,
    scopes,
    expires_at: expiresAt,
    created_by: user?.userId ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { ok: true, key: generated.key, keyName: parsed.data.name };
}

const idSchema = z.string().uuid();

/**
 * Revoke, never delete: the request log references the key, and a company
 * investigating an incident needs to see which key made those calls.
 */
export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  await requireCompanyFeature('api_access');
  const companyId = await getCompanyId();
  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return;

  const sb = createSupabaseServiceClient();
  await sb
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    // TENANT ISOLATION: a key id from another company matches nothing.
    .eq('company_id', companyId)
    .eq('id', id.data)
    .is('revoked_at', null);
  revalidatePath(PATH);
}

export type TestEventState = ActionState & { message?: string };

const eventSchema = z.string().min(1).max(80);

/** Send the catalogue's sample payload for one event to subscribed endpoints. */
export async function sendTestEventAction(
  _prev: TestEventState,
  formData: FormData,
): Promise<TestEventState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  if (!(await companyHasFeature('api_access'))) {
    return { error: 'Your plan does not include API access. See Billing to change your package.' };
  }
  const companyId = await getCompanyId();
  const parsed = eventSchema.safeParse(formData.get('event'));
  if (!parsed.success) return { error: 'Choose an event to test.' };

  const result = await sendTestEvent(companyId, parsed.data);
  revalidatePath(PATH);
  return result.ok ? { ok: true, message: result.message } : { error: result.message };
}
