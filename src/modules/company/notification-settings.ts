import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { getCompanyId } from './data';
import { DELIVERY_CHANNELS, NOTIFICATION_EVENTS } from './notification-options';

export type EventRules = Record<string, Record<string, boolean>>;

export interface CompanyNotificationSettingsView {
  notificationsEnabled: boolean;
  emailEnabled: boolean;
  emailSenderMode: 'platform' | 'company_smtp';
  emailTo: string[];
  emailCc: string[];
  emailBcc: string[];
  emailReplyTo: string;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  hasSmtpPassword: boolean;
  smtpSecure: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
  whatsappEnabled: boolean;
  whatsappRecipients: string[];
  slackEnabled: boolean;
  hasSlackWebhook: boolean;
  webhookEnabled: boolean;
  hasGenericWebhookUrl: boolean;
  hasGenericWebhookSecret: boolean;
  eventRules: EventRules;
}

export interface NotificationDeliveryLogRow {
  id: string;
  eventType: string;
  channel: string;
  recipient: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function defaultRules(): EventRules {
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [
      event.key,
      Object.fromEntries(DELIVERY_CHANNELS.map((channel) => [channel.key, true])),
    ]),
  );
}

export async function getCompanyNotificationSettings(): Promise<CompanyNotificationSettingsView> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_notification_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;
  const rules = row.event_rules_json && typeof row.event_rules_json === 'object'
    ? (row.event_rules_json as EventRules)
    : defaultRules();

  return {
    notificationsEnabled: row.notifications_enabled !== false,
    emailEnabled: Boolean(row.email_enabled),
    emailSenderMode: row.email_sender_mode === 'company_smtp' ? 'company_smtp' : 'platform',
    emailTo: arr(row.email_to),
    emailCc: arr(row.email_cc),
    emailBcc: arr(row.email_bcc),
    emailReplyTo: (row.email_reply_to as string) ?? '',
    smtpHost: (row.smtp_host as string) ?? '',
    smtpPort: row.smtp_port == null ? '' : String(row.smtp_port),
    smtpUsername: (row.smtp_username as string) ?? '',
    hasSmtpPassword: Boolean(row.smtp_password_encrypted),
    smtpSecure: row.smtp_secure !== false,
    smtpFromEmail: (row.smtp_from_email as string) ?? '',
    smtpFromName: (row.smtp_from_name as string) ?? '',
    whatsappEnabled: Boolean(row.whatsapp_enabled),
    whatsappRecipients: arr(row.whatsapp_recipients),
    slackEnabled: Boolean(row.slack_enabled),
    hasSlackWebhook: Boolean(row.slack_webhook_encrypted),
    webhookEnabled: Boolean(row.webhook_enabled),
    hasGenericWebhookUrl: Boolean(row.generic_webhook_url_encrypted),
    hasGenericWebhookSecret: Boolean(row.generic_webhook_secret_encrypted),
    eventRules: { ...defaultRules(), ...rules },
  };
}

export async function listNotificationDeliveryLogs(limit = 100): Promise<NotificationDeliveryLogRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('notification_delivery_logs')
    .select('id,event_type,channel,recipient,status,error_message,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: row.id as string,
    eventType: row.event_type as string,
    channel: row.channel as string,
    recipient: (row.recipient as string) ?? null,
    status: row.status as string,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: row.created_at as string,
  }));
}

export function linesToArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return Array.from(
    new Set(
      value
        .split(/[\n\r,]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ).slice(0, 30);
}

export function secretOrExisting(nextValue: string | undefined, existingEncrypted?: unknown): string | null {
  if (nextValue?.trim()) return encryptSecret(nextValue.trim());
  if (typeof existingEncrypted === 'string') {
    try {
      decryptSecret(existingEncrypted);
      return existingEncrypted;
    } catch {
      return null;
    }
  }
  return null;
}
