import { createSupabaseServiceClient } from '@/lib/db/server';

export interface PlatformNotificationSettingsView {
  whatsappProvider: 'disabled' | 'meta_cloud' | 'twilio';
  metaPhoneNumberId: string;
  metaTemplateName: string;
  metaTemplateLanguage: string;
  hasMetaAccessToken: boolean;
  twilioAccountSid: string;
  twilioWhatsappFrom: string;
  hasTwilioAuthToken: boolean;
  defaultEmailMode: string;
}

const keys = [
  'notifications.whatsapp_provider',
  'notifications.meta_phone_number_id',
  'notifications.meta_template_name',
  'notifications.meta_template_language',
  'notifications.meta_access_token',
  'notifications.twilio_account_sid',
  'notifications.twilio_auth_token',
  'notifications.twilio_whatsapp_from',
  'notifications.default_email_mode',
];

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export async function getPlatformNotificationSettings(): Promise<PlatformNotificationSettingsView> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb.from('platform_settings').select('key,value_json,is_secret').in('key', keys);
  const map = new Map((data ?? []).map((row) => [row.key as string, row]));
  const get = (key: string) => map.get(key)?.value_json;
  const hasSecret = (key: string) => Boolean(map.get(key)?.is_secret);
  const provider = str(get('notifications.whatsapp_provider'), 'disabled');

  return {
    whatsappProvider:
      provider === 'meta_cloud' || provider === 'twilio' ? provider : 'disabled',
    metaPhoneNumberId: str(get('notifications.meta_phone_number_id')),
    metaTemplateName: str(get('notifications.meta_template_name')),
    metaTemplateLanguage: str(get('notifications.meta_template_language'), 'en_GB'),
    hasMetaAccessToken: hasSecret('notifications.meta_access_token'),
    twilioAccountSid: str(get('notifications.twilio_account_sid')),
    twilioWhatsappFrom: str(get('notifications.twilio_whatsapp_from')),
    hasTwilioAuthToken: hasSecret('notifications.twilio_auth_token'),
    defaultEmailMode: str(get('notifications.default_email_mode'), 'platform'),
  };
}
