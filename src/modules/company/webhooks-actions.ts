'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import {
  WEBHOOK_EVENTS,
  planWebhookLimits,
  newSigningSecret,
  maskUrl,
  sendTestWebhook,
} from '@/lib/webhooks';
import { getSubscription } from '@/lib/billing';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const PATH = '/company/webhooks';

const createSchema = z.object({
  kind: z.enum(['generic', 'slack']),
  url: z.string().url('Enter a valid https URL').refine((u) => u.startsWith('https://'), 'URL must use https'),
  label: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().max(80).optional()),
});

export async function createWebhookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const parsed = createSchema.safeParse({
    kind: formData.get('kind'),
    url: formData.get('url'),
    label: formData.get('label'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // Selected events (Slack defaults to all if none chosen).
  let events = formData
    .getAll('events')
    .map(String)
    .filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) events = [...WEBHOOK_EVENTS];

  const sb = createSupabaseServiceClient();

  // Enforce the per-plan endpoint cap (server-cost control).
  const sub = await getSubscription(companyId);
  const limits = planWebhookLimits(sub?.plan);
  const { count } = await sb
    .from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  if ((count ?? 0) >= limits.maxEndpoints) {
    return { error: `Your plan allows up to ${limits.maxEndpoints} webhook endpoint(s).` };
  }

  const { kind, url, label } = parsed.data;
  const { error } = await sb.from('webhook_endpoints').insert({
    company_id: companyId,
    kind,
    url_encrypted: encryptSecret(url),
    url_preview: kind === 'slack' ? maskUrl(url) : url,
    secret: kind === 'generic' ? newSigningSecret() : null,
    events,
    active: true,
    label: label ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('webhook_endpoints')
    .delete()
    .eq('id', parsed.data.id)
    .eq('company_id', companyId);
  revalidatePath(PATH);
}

export async function toggleWebhookAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = z
    .object({ id: z.string().uuid(), active: z.enum(['true', 'false']) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('webhook_endpoints')
    .update({ active: parsed.data.active === 'true' })
    .eq('id', parsed.data.id)
    .eq('company_id', companyId);
  revalidatePath(PATH);
}

export async function testWebhookAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await sendTestWebhook(companyId, parsed.data.id);
  revalidatePath(PATH);
}
