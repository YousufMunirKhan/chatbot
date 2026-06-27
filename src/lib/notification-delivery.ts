import { createHmac } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { sendEmail, sendSmtpEmail } from '@/lib/email';
import { errorMessage, errorStack, logAppError } from '@/lib/application-errors';

export type DeliveryChannel = 'email' | 'whatsapp' | 'slack' | 'webhook';

export interface NotificationDeliveryEvent {
  companyId: string;
  eventType: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

interface CompanyNotificationSettings {
  companyId: string;
  notificationsEnabled: boolean;
  emailEnabled: boolean;
  emailSenderMode: 'platform' | 'company_smtp';
  emailTo: string[];
  emailCc: string[];
  emailBcc: string[];
  emailReplyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  whatsappEnabled: boolean;
  whatsappRecipients: string[];
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  webhookEnabled: boolean;
  genericWebhookUrl: string | null;
  genericWebhookSecret: string | null;
  eventRules: Record<string, Partial<Record<DeliveryChannel, boolean>>>;
}

const CORE_EVENTS = new Set([
  'new_lead',
  'new_appointment',
  'new_order',
  'human_takeover',
  'missed_conversation',
]);

const CHANNELS: DeliveryChannel[] = ['email', 'whatsapp', 'slack', 'webhook'];

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function decryptMaybe(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textBody(event: NotificationDeliveryEvent): string {
  return [event.title, event.body].filter(Boolean).join('\n\n');
}

function htmlBody(event: NotificationDeliveryEvent): string {
  const body = event.body ? `<p>${escapeHtml(event.body)}</p>` : '';
  const details = Object.entries(event.data ?? {})
    .filter(([, value]) => value != null && typeof value !== 'object')
    .slice(0, 12)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  return [
    `<h2>${escapeHtml(event.title)}</h2>`,
    body,
    details ? `<table cellpadding="6" cellspacing="0" border="1">${details}</table>` : '',
  ].join('');
}

function relatedIds(data: Record<string, unknown> | undefined) {
  return {
    related_lead_id: typeof data?.leadId === 'string' ? data.leadId : null,
    related_appointment_id: typeof data?.appointmentId === 'string' ? data.appointmentId : null,
    related_order_id: typeof data?.orderId === 'string' ? data.orderId : null,
    conversation_id: typeof data?.conversationId === 'string' ? data.conversationId : null,
  };
}

async function logDelivery(params: {
  event: NotificationDeliveryEvent;
  channel: DeliveryChannel;
  recipient?: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sb = createSupabaseServiceClient();
  await sb.from('notification_delivery_logs').insert({
    company_id: params.event.companyId,
    event_type: params.event.eventType,
    channel: params.channel,
    recipient: params.recipient ?? null,
    status: params.status,
    error_message: params.error ?? null,
    ...relatedIds(params.event.data),
    metadata_json: params.metadata ?? {},
  });
}

async function loadSettings(companyId: string): Promise<CompanyNotificationSettings | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_notification_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    companyId,
    notificationsEnabled: row.notifications_enabled !== false,
    emailEnabled: Boolean(row.email_enabled),
    emailSenderMode: row.email_sender_mode === 'company_smtp' ? 'company_smtp' : 'platform',
    emailTo: asStringArray(row.email_to),
    emailCc: asStringArray(row.email_cc),
    emailBcc: asStringArray(row.email_bcc),
    emailReplyTo: (row.email_reply_to as string) ?? null,
    smtpHost: (row.smtp_host as string) ?? null,
    smtpPort: typeof row.smtp_port === 'number' ? row.smtp_port : null,
    smtpUsername: (row.smtp_username as string) ?? null,
    smtpPassword: decryptMaybe(row.smtp_password_encrypted),
    smtpSecure: row.smtp_secure !== false,
    smtpFromEmail: (row.smtp_from_email as string) ?? null,
    smtpFromName: (row.smtp_from_name as string) ?? null,
    whatsappEnabled: Boolean(row.whatsapp_enabled),
    whatsappRecipients: asStringArray(row.whatsapp_recipients),
    slackEnabled: Boolean(row.slack_enabled),
    slackWebhookUrl: decryptMaybe(row.slack_webhook_encrypted),
    webhookEnabled: Boolean(row.webhook_enabled),
    genericWebhookUrl: decryptMaybe(row.generic_webhook_url_encrypted),
    genericWebhookSecret: decryptMaybe(row.generic_webhook_secret_encrypted),
    eventRules:
      row.event_rules_json && typeof row.event_rules_json === 'object'
        ? (row.event_rules_json as Record<string, Partial<Record<DeliveryChannel, boolean>>>)
        : {},
  };
}

async function readPlatformSetting(key: string): Promise<unknown> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('platform_settings')
    .select('value_json,is_secret')
    .eq('key', key)
    .maybeSingle();
  if (!data) return null;
  const value = (data as { value_json: unknown; is_secret: boolean }).value_json;
  if ((data as { is_secret: boolean }).is_secret) return decryptMaybe(value);
  return value;
}

function channelAllowed(settings: CompanyNotificationSettings, eventType: string, channel: DeliveryChannel): boolean {
  const eventRule = settings.eventRules[eventType];
  if (eventRule && typeof eventRule[channel] === 'boolean') return Boolean(eventRule[channel]);
  return CORE_EVENTS.has(eventType);
}

async function deliverEmail(event: NotificationDeliveryEvent, settings: CompanyNotificationSettings) {
  const recipients = settings.emailTo;
  if (!recipients.length) {
    await logDelivery({ event, channel: 'email', status: 'skipped', error: 'No email recipients configured' });
    return;
  }

  try {
    const result =
      settings.emailSenderMode === 'company_smtp'
        ? await sendSmtpEmail({
            host: settings.smtpHost ?? '',
            port: settings.smtpPort ?? 587,
            secure: settings.smtpSecure,
            username: settings.smtpUsername,
            password: settings.smtpPassword,
            from: settings.smtpFromName
              ? `${settings.smtpFromName} <${settings.smtpFromEmail ?? ''}>`
              : settings.smtpFromEmail ?? '',
            to: recipients,
            cc: settings.emailCc,
            bcc: settings.emailBcc,
            replyTo: settings.emailReplyTo,
            subject: event.title,
            html: htmlBody(event),
          })
        : await sendEmail({
            to: recipients,
            cc: settings.emailCc,
            bcc: settings.emailBcc,
            replyTo: settings.emailReplyTo,
            subject: event.title,
            html: htmlBody(event),
          });
    await logDelivery({
      event,
      channel: 'email',
      recipient: recipients.join(', '),
      status: result.sent ? 'sent' : 'failed',
      error: result.sent ? null : 'Email provider did not send the message',
    });
  } catch (err) {
    await logFailed(event, 'email', recipients.join(', '), err);
  }
}

async function deliverSlack(event: NotificationDeliveryEvent, settings: CompanyNotificationSettings) {
  if (!settings.slackWebhookUrl) {
    await logDelivery({ event, channel: 'slack', status: 'skipped', error: 'No Slack webhook configured' });
    return;
  }
  try {
    const res = await fetch(settings.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textBody(event) }),
    });
    if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
    await logDelivery({ event, channel: 'slack', recipient: 'slack_webhook', status: 'sent' });
  } catch (err) {
    await logFailed(event, 'slack', 'slack_webhook', err);
  }
}

async function deliverWebhook(event: NotificationDeliveryEvent, settings: CompanyNotificationSettings) {
  if (!settings.genericWebhookUrl) {
    await logDelivery({ event, channel: 'webhook', status: 'skipped', error: 'No webhook URL configured' });
    return;
  }
  try {
    const body = JSON.stringify({
      event: event.eventType,
      title: event.title,
      body: event.body ?? null,
      companyId: event.companyId,
      data: event.data ?? {},
      sentAt: new Date().toISOString(),
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.genericWebhookSecret) {
      headers['X-SwitchSave-Signature'] = createHmac('sha256', settings.genericWebhookSecret)
        .update(body)
        .digest('hex');
    }
    const res = await fetch(settings.genericWebhookUrl, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    await logDelivery({ event, channel: 'webhook', recipient: settings.genericWebhookUrl, status: 'sent' });
  } catch (err) {
    await logFailed(event, 'webhook', settings.genericWebhookUrl, err);
  }
}

async function deliverWhatsApp(event: NotificationDeliveryEvent, settings: CompanyNotificationSettings) {
  const recipients = settings.whatsappRecipients;
  if (!recipients.length) {
    await logDelivery({ event, channel: 'whatsapp', status: 'skipped', error: 'No WhatsApp recipients configured' });
    return;
  }

  const provider = String((await readPlatformSetting('notifications.whatsapp_provider')) ?? 'disabled');
  if (provider === 'disabled') {
    await logDelivery({
      event,
      channel: 'whatsapp',
      recipient: recipients.join(', '),
      status: 'skipped',
      error: 'Platform WhatsApp provider is disabled',
    });
    return;
  }

  await Promise.all(
    recipients.map(async (to) => {
      try {
        if (provider === 'twilio') await sendTwilioWhatsApp(to, textBody(event));
        else if (provider === 'meta_cloud') await sendMetaWhatsApp(to, event);
        else throw new Error(`Unsupported WhatsApp provider: ${provider}`);
        await logDelivery({ event, channel: 'whatsapp', recipient: to, status: 'sent' });
      } catch (err) {
        await logFailed(event, 'whatsapp', to, err);
      }
    }),
  );
}

async function sendTwilioWhatsApp(to: string, body: string) {
  const [sid, token, from] = await Promise.all([
    readPlatformSetting('notifications.twilio_account_sid'),
    readPlatformSetting('notifications.twilio_auth_token'),
    readPlatformSetting('notifications.twilio_whatsapp_from'),
  ]);
  if (!sid || !token || !from) throw new Error('Twilio WhatsApp is not fully configured');
  const params = new URLSearchParams();
  params.set('From', String(from).startsWith('whatsapp:') ? String(from) : `whatsapp:${from}`);
  params.set('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
  params.set('Body', body.slice(0, 1400));
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) throw new Error(`Twilio WhatsApp returned ${res.status}`);
}

async function sendMetaWhatsApp(to: string, event: NotificationDeliveryEvent) {
  const [token, phoneNumberId, templateName, languageCode] = await Promise.all([
    readPlatformSetting('notifications.meta_access_token'),
    readPlatformSetting('notifications.meta_phone_number_id'),
    readPlatformSetting('notifications.meta_template_name'),
    readPlatformSetting('notifications.meta_template_language'),
  ]);
  if (!token || !phoneNumberId || !templateName) {
    throw new Error('Meta WhatsApp is not fully configured');
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^whatsapp:/, ''),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode || 'en_GB' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: event.title.slice(0, 120) },
              { type: 'text', text: (event.body ?? '').slice(0, 600) || '-' },
            ],
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`Meta WhatsApp returned ${res.status}`);
}

async function logFailed(event: NotificationDeliveryEvent, channel: DeliveryChannel, recipient: string | null, err: unknown) {
  const message = errorMessage(err);
  await logDelivery({ event, channel, recipient, status: 'failed', error: message });
  await logAppError({
    companyId: event.companyId,
    conversationId: relatedIds(event.data).conversation_id,
    source: 'notification_delivery',
    severity: 'warning',
    message: `${channel} notification failed: ${message}`,
    stack: errorStack(err),
    metadata: {
      eventType: event.eventType,
      recipient,
      data: event.data ?? {},
    },
  });
}

export async function sendNotificationEvent(event: NotificationDeliveryEvent): Promise<void> {
  try {
    const settings = await loadSettings(event.companyId);
    if (!settings || !settings.notificationsEnabled) return;

    const tasks: Array<Promise<void>> = [];
    if (settings.emailEnabled && channelAllowed(settings, event.eventType, 'email')) {
      tasks.push(deliverEmail(event, settings));
    }
    if (settings.whatsappEnabled && channelAllowed(settings, event.eventType, 'whatsapp')) {
      tasks.push(deliverWhatsApp(event, settings));
    }
    if (settings.slackEnabled && channelAllowed(settings, event.eventType, 'slack')) {
      tasks.push(deliverSlack(event, settings));
    }
    if (settings.webhookEnabled && channelAllowed(settings, event.eventType, 'webhook')) {
      tasks.push(deliverWebhook(event, settings));
    }
    await Promise.allSettled(tasks);
  } catch (err) {
    await logAppError({
      companyId: event.companyId,
      conversationId: relatedIds(event.data).conversation_id,
      source: 'notification_delivery',
      severity: 'warning',
      message: `Notification fan-out failed: ${errorMessage(err)}`,
      stack: errorStack(err),
      metadata: { eventType: event.eventType },
    });
  }
}

export { CHANNELS };
