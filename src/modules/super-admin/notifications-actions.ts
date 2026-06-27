'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { upsertPlatformSetting } from '@/lib/platform-settings';

export type PlatformNotificationsActionState = { error?: string; ok?: boolean };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

const schema = z.object({
  whatsappProvider: z.enum(['disabled', 'meta_cloud', 'twilio']),
  metaPhoneNumberId: optText,
  metaAccessToken: optText,
  metaTemplateName: optText,
  metaTemplateLanguage: optText,
  twilioAccountSid: optText,
  twilioAuthToken: optText,
  twilioWhatsappFrom: optText,
  defaultEmailMode: z.enum(['platform', 'company_smtp']).default('platform'),
});

export async function updatePlatformNotificationsAction(
  _prev: PlatformNotificationsActionState,
  formData: FormData,
): Promise<PlatformNotificationsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  try {
    await Promise.all([
      upsertPlatformSetting({
        key: 'notifications.whatsapp_provider',
        value: v.whatsappProvider,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.meta_phone_number_id',
        value: v.metaPhoneNumberId ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.meta_template_name',
        value: v.metaTemplateName ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.meta_template_language',
        value: v.metaTemplateLanguage ?? 'en_GB',
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.twilio_account_sid',
        value: v.twilioAccountSid ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.twilio_whatsapp_from',
        value: v.twilioWhatsappFrom ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'notifications.default_email_mode',
        value: v.defaultEmailMode,
        updatedBy: admin.userId,
      }),
      v.metaAccessToken
        ? upsertPlatformSetting({
            key: 'notifications.meta_access_token',
            value: v.metaAccessToken,
            isSecret: true,
            updatedBy: admin.userId,
          })
        : Promise.resolve(),
      v.twilioAuthToken
        ? upsertPlatformSetting({
            key: 'notifications.twilio_auth_token',
            value: v.twilioAuthToken,
            isSecret: true,
            updatedBy: admin.userId,
          })
        : Promise.resolve(),
    ]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save platform notifications' };
  }

  revalidatePath('/super-admin/notifications');
  return { ok: true };
}
