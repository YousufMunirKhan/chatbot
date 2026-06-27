'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import {
  normalizeList,
  parseFormSchema,
  parseQuickActionConfig,
  type QuickActionType,
} from '@/lib/quick-actions';
import { getCompanyId } from './data';

export type QuickActionState = { error?: string; ok?: boolean };

const ACTION_TYPES = [
  'send_message',
  'direct_answer',
  'lead_form',
  'appointment_form',
  'external_link',
  'product_link',
  'whatsapp',
  'phone_call',
  'request_human',
  'tool_action',
] as const;

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());
const optUuid = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().uuid().optional());

const schema = z.object({
  id: optUuid,
  botId: optUuid,
  label: z.string().min(1, 'Label is required').max(80),
  description: optText,
  actionType: z.enum(ACTION_TYPES),
  messageText: optText,
  directAnswer: optText,
  url: optText,
  phone: optText,
  customConfig: optText,
  formSchema: optText,
  contexts: optText,
  keywordTriggers: optText,
  pageUrlPatterns: optText,
  requiredCapabilities: optText,
  businessHoursMode: z.enum(['any', 'during_hours', 'after_hours']).default('any'),
  conversationStatuses: optText,
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  isActive: z.preprocess((x) => x === 'on', z.boolean()),
  startsNewMessage: z.preprocess((x) => x === 'on', z.boolean()),
});

function payload(companyId: string, v: z.infer<typeof schema>) {
  const actionType = v.actionType as QuickActionType;
  return {
    company_id: companyId,
    bot_id: v.botId ?? null,
    label: v.label,
    description: v.description ?? null,
    action_type: actionType,
    action_config_json: parseQuickActionConfig({
      actionType,
      customConfig: v.customConfig,
      messageText: v.messageText,
      directAnswer: v.directAnswer,
      url: v.url,
      phone: v.phone,
    }),
    form_schema_json: parseFormSchema(v.formSchema),
    contexts: normalizeList(v.contexts),
    keyword_triggers: normalizeList(v.keywordTriggers),
    page_url_patterns: normalizeList(v.pageUrlPatterns),
    required_capabilities: normalizeList(v.requiredCapabilities),
    business_hours_mode: v.businessHoursMode,
    conversation_statuses: normalizeList(v.conversationStatuses),
    priority: v.priority,
    is_active: v.isActive,
    starts_new_message: v.startsNewMessage,
  };
}

export async function saveQuickActionAction(_prev: QuickActionState, formData: FormData): Promise<QuickActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  const sb = createSupabaseServiceClient();

  let error;
  try {
    if (v.id) {
      ({ error } = await sb.from('bot_quick_actions').update(payload(companyId, v)).eq('company_id', companyId).eq('id', v.id));
    } else {
      ({ error } = await sb.from('bot_quick_actions').insert(payload(companyId, v)));
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save quick action' };
  }
  if (error) return { error: error.message };
  revalidatePath('/company/quick-actions');
  return { ok: true };
}

const idSchema = z.object({ id: z.string().uuid() });

export async function deleteQuickActionAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await createSupabaseServiceClient()
    .from('bot_quick_actions')
    .delete()
    .eq('company_id', companyId)
    .eq('id', parsed.data.id);
  revalidatePath('/company/quick-actions');
}
