'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { getCompanyId } from './data';
import { DELIVERY_CHANNELS, NOTIFICATION_EVENTS } from './notification-options';
import { linesToArray } from './notification-settings';

export async function markAllReadAction(_formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  await sb
    .from('notifications')
    .update({ read: true })
    .eq('company_id', companyId)
    .eq('read', false);
  revalidatePath('/company/notifications');
}

const markReadSchema = z.object({ notificationId: z.string().uuid() });

export async function markReadAction(formData: FormData): Promise<void> {
  await requireRole([ROLES.COMPANY_ADMIN, ROLES.AGENT]);
  const companyId = await getCompanyId();
  const parsed = markReadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const sb = createSupabaseServiceClient();
  await sb
    .from('notifications')
    .update({ read: true })
    .eq('id', parsed.data.notificationId)
    .eq('company_id', companyId); // scope guard
  revalidatePath('/company/notifications');
}

function textValue(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function keepExistingSecret(
  companyId: string,
  column: string,
  nextValue: string | null,
): Promise<string | null> {
  if (nextValue) return encryptSecret(nextValue);
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_notification_settings')
    .select(column)
    .eq('company_id', companyId)
    .maybeSingle();
  const existing = data ? (data as unknown as Record<string, unknown>)[column] : null;
  return typeof existing === 'string' ? existing : null;
}

export type NotificationSettingsActionState = { error?: string; ok?: boolean };

export async function saveNotificationSettingsAction(
  _prev: NotificationSettingsActionState,
  formData: FormData,
): Promise<NotificationSettingsActionState> {
  await requireRole([ROLES.COMPANY_ADMIN]);
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const eventRules = Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [
      event.key,
      Object.fromEntries(
        DELIVERY_CHANNELS.map((channel) => [
          channel.key,
          formData.get(`${event.key}.${channel.key}`) === 'on',
        ]),
      ),
    ]),
  );

  const emailSenderMode =
    formData.get('emailSenderMode') === 'company_smtp' ? 'company_smtp' : 'platform';
  const smtpPortRaw = textValue(formData, 'smtpPort');
  const smtpPort = smtpPortRaw ? Number(smtpPortRaw) : null;
  if (smtpPortRaw && (!Number.isInteger(smtpPort) || smtpPort! <= 0)) {
    return { error: 'SMTP port must be a valid number.' };
  }

  try {
    const [
      smtpPassword,
      slackWebhook,
      genericWebhookUrl,
      genericWebhookSecret,
      metaAccessToken,
      twilioAuthToken,
    ] = await Promise.all([
      keepExistingSecret(companyId, 'smtp_password_encrypted', textValue(formData, 'smtpPassword')),
      keepExistingSecret(companyId, 'slack_webhook_encrypted', textValue(formData, 'slackWebhookUrl')),
      keepExistingSecret(
        companyId,
        'generic_webhook_url_encrypted',
        textValue(formData, 'genericWebhookUrl'),
      ),
      keepExistingSecret(
        companyId,
        'generic_webhook_secret_encrypted',
        textValue(formData, 'genericWebhookSecret'),
      ),
      keepExistingSecret(
        companyId,
        'meta_access_token_encrypted',
        textValue(formData, 'metaAccessToken'),
      ),
      keepExistingSecret(
        companyId,
        'twilio_auth_token_encrypted',
        textValue(formData, 'twilioAuthToken'),
      ),
    ]);
    const whatsappProvider = ['meta_cloud', 'twilio'].includes(String(formData.get('whatsappProvider')))
      ? String(formData.get('whatsappProvider'))
      : 'disabled';

    const { error } = await sb.from('company_notification_settings').upsert(
      {
        company_id: companyId,
        notifications_enabled: formData.get('notificationsEnabled') === 'on',
        email_enabled: formData.get('emailEnabled') === 'on',
        email_sender_mode: emailSenderMode,
        email_to: linesToArray(formData.get('emailTo')),
        email_cc: linesToArray(formData.get('emailCc')),
        email_bcc: linesToArray(formData.get('emailBcc')),
        email_reply_to: textValue(formData, 'emailReplyTo'),
        smtp_host: textValue(formData, 'smtpHost'),
        smtp_port: smtpPort,
        smtp_username: textValue(formData, 'smtpUsername'),
        smtp_password_encrypted: smtpPassword,
        smtp_secure: formData.get('smtpSecure') === 'on',
        smtp_from_email: textValue(formData, 'smtpFromEmail'),
        smtp_from_name: textValue(formData, 'smtpFromName'),
        whatsapp_enabled: formData.get('whatsappEnabled') === 'on',
        whatsapp_sender_mode:
          formData.get('whatsappSenderMode') === 'platform_managed'
            ? 'platform_managed'
            : 'company',
        whatsapp_provider: whatsappProvider,
        whatsapp_recipients: linesToArray(formData.get('whatsappRecipients')),
        meta_phone_number_id: textValue(formData, 'metaPhoneNumberId'),
        meta_access_token_encrypted: metaAccessToken,
        meta_template_name: textValue(formData, 'metaTemplateName'),
        meta_template_language: textValue(formData, 'metaTemplateLanguage') ?? 'en_GB',
        twilio_account_sid: textValue(formData, 'twilioAccountSid'),
        twilio_auth_token_encrypted: twilioAuthToken,
        twilio_whatsapp_from: textValue(formData, 'twilioWhatsappFrom'),
        slack_enabled: formData.get('slackEnabled') === 'on',
        slack_webhook_encrypted: slackWebhook,
        webhook_enabled: formData.get('webhookEnabled') === 'on',
        generic_webhook_url_encrypted: genericWebhookUrl,
        generic_webhook_secret_encrypted: genericWebhookSecret,
        event_rules_json: eventRules,
      },
      { onConflict: 'company_id' },
    );
    if (error) return { error: error.message };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save notification settings' };
  }

  revalidatePath('/company/notifications');
  return { ok: true };
}
