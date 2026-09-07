'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { AUTOMATION_EVENTS } from '@/lib/commerce/automation-templates';
import { getStarterRule } from '@/lib/commerce/starter-rules';
import { getCompanyId } from './data';

export type ActionState = { error?: string; ok?: boolean };

const PATH = '/company/automations';

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const schema = z.object({
  id: optText,
  name: z.string().min(1, 'Give the automation a name').max(120),
  triggerEvent: z.enum(AUTOMATION_EVENTS),
  channel: z.enum(['whatsapp', 'email']),
  templateName: z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().max(200).optional()),
  messageTemplate: z.string().min(1, 'Write the message that gets sent').max(4000),
  delayMinutes: z.coerce.number().int().min(0, 'Delay cannot be negative').max(20160).default(0),
  abandonAfterMinutes: z.coerce.number().int().min(1).max(20160).optional(),
  minTotal: z.coerce.number().min(0).optional(),
  isActive: optText,
});

/**
 * Create or update one rule.
 *
 * The advanced condition fields are folded into `conditions_json` here so the
 * form stays four plain inputs instead of a JSON textarea nobody fills in
 * correctly.
 */
export async function saveAutomationRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();

  const raw = Object.fromEntries(formData);
  // Empty numeric inputs must stay undefined, not become 0/NaN.
  for (const key of ['abandonAfterMinutes', 'minTotal'] as const) {
    if (raw[key] === '') delete raw[key];
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid automation' };
  const v = parsed.data;

  const conditions: Record<string, unknown> = {};
  if (v.triggerEvent === 'cart_abandoned' && v.abandonAfterMinutes) {
    conditions.abandonAfterMinutes = v.abandonAfterMinutes;
  }
  if (v.minTotal != null) conditions.minTotal = v.minTotal;

  const payload = {
    name: v.name,
    trigger_event: v.triggerEvent,
    channel: v.channel,
    template_name: v.templateName ?? null,
    message_template: v.messageTemplate,
    delay_minutes: v.delayMinutes,
    conditions_json: conditions,
    is_active: v.isActive === 'on' || v.isActive === 'true',
  };

  const sb = createSupabaseServiceClient();
  if (v.id) {
    const id = z.string().uuid().safeParse(v.id);
    if (!id.success) return { error: 'Unknown automation' };
    // MULTI-TENANT: the company filter is what stops one tenant editing another's rule.
    const { error } = await sb
      .from('automation_rules')
      .update(payload)
      .eq('company_id', companyId)
      .eq('id', id.data);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from('automation_rules').insert({ company_id: companyId, ...payload });
    if (error) return { error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Add one of the four pre-filled starter automations, paused-safe and active. */
export async function addStarterRuleAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const starter = getStarterRule(String(formData.get('key') ?? ''));
  if (!starter) return;

  const sb = createSupabaseServiceClient();
  // Adding the same starter twice is a double-click, not an intent.
  const { data: existing } = await sb
    .from('automation_rules')
    .select('id')
    .eq('company_id', companyId)
    .eq('name', starter.name)
    .maybeSingle();
  if (existing) return;

  await sb.from('automation_rules').insert({
    company_id: companyId,
    name: starter.name,
    trigger_event: starter.triggerEvent,
    channel: starter.channel,
    template_name: starter.templateName,
    message_template: starter.messageTemplate,
    delay_minutes: starter.delayMinutes,
    conditions_json: starter.conditions,
    is_active: true,
  });
  revalidatePath(PATH);
}

export async function toggleAutomationRuleAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('automation_rules')
    .update({ is_active: formData.get('active') === 'true' })
    .eq('company_id', companyId)
    .eq('id', id.data);
  revalidatePath(PATH);
}

export async function deleteAutomationRuleAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb.from('automation_rules').delete().eq('company_id', companyId).eq('id', id.data);
  revalidatePath(PATH);
}

/**
 * Issue (or rotate) the token that identifies this company's store webhooks.
 * 32 random bytes, so the URL is the credential — there is nothing else in a
 * store webhook that says which tenant it belongs to.
 */
export async function issueStoreWebhookTokenAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const id = z.string().uuid().safeParse(formData.get('integrationId'));
  if (!id.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('integration_accounts')
    .update({ webhook_token: randomBytes(24).toString('base64url') })
    .eq('company_id', companyId)
    .eq('id', id.data);
  revalidatePath(PATH);
}
