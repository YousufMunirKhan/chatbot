import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { sendNotificationEvent } from '@/lib/notification-delivery';
import {
  dispatchWebhookEvent,
  NOTIFICATION_TO_EVENT,
  NO_WEBHOOK_COVERAGE,
  type WebhookEventCoverage,
} from '@/lib/webhooks';
import type { DeliveryChannel } from '@/lib/notification-delivery';

/**
 * Notifications (Module 24). Writes an in-dashboard notification and (optionally)
 * emails the company's admins. Events: new lead, human-takeover required, missed
 * conversation, new appointment, new order, failed payment, failed sync, over
 * usage limit, integration disconnected.
 */
export type NotificationType =
  | 'new_lead'
  | 'human_takeover'
  | 'missed_conversation'
  | 'new_appointment'
  | 'new_order'
  | 'helpdesk_issue_reported'
  | 'helpdesk_issue_resolved'
  | 'failed_payment'
  | 'failed_sync'
  | 'over_usage_limit'
  | 'integration_disconnected';

export async function notify(params: {
  companyId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  email?: boolean;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('notifications').insert({
    company_id: params.companyId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    data_json: params.data ?? {},
  });

  // Fan the event out to the company's own systems (generic webhook / Slack /
  // Zapier). Guarded internally — never breaks the in-app notification or email.
  const webhookEvent = NOTIFICATION_TO_EVENT[params.type];
  let coverage: WebhookEventCoverage = NO_WEBHOOK_COVERAGE;
  if (webhookEvent) {
    coverage = await dispatchWebhookEvent({
      companyId: params.companyId,
      event: webhookEvent,
      title: params.title,
      body: params.body,
      data: params.data,
    });
  }

  // The notification-settings Slack / generic-webhook channels below cover the
  // same events as the webhook endpoints above, so a company that pasted its
  // Slack URL into both screens received every alert twice. Hand the endpoint
  // coverage down and let the second system stand aside for exactly the
  // channels already delivered. Email and WhatsApp are never affected.
  const suppressedChannels: DeliveryChannel[] = [];
  if (coverage.slack) suppressedChannels.push('slack');
  if (coverage.generic) suppressedChannels.push('webhook');

  await sendNotificationEvent({
    companyId: params.companyId,
    eventType: params.type,
    title: params.title,
    body: params.body,
    data: params.data,
    suppressedChannels,
  });

  if (params.email) {
    const { data: deliverySettings } = await sb
      .from('company_notification_settings')
      .select('company_id')
      .eq('company_id', params.companyId)
      .maybeSingle();
    if (deliverySettings) return;

    // Email each company admin.
    const { data: members } = await sb
      .from('company_users')
      .select('users(email)')
      .eq('company_id', params.companyId)
      .eq('role', 'company_admin');
    const emails = (members ?? [])
      .map((m) => {
        const u = (m as Record<string, unknown>).users;
        const user = Array.isArray(u) ? u[0] : u;
        return (user as { email?: string } | null)?.email;
      })
      .filter((e): e is string => Boolean(e));

    await Promise.all(
      emails.map((to) =>
        sendEmail({
          to,
          subject: params.title,
          html: `<h2>${params.title}</h2><p>${params.body ?? ''}</p>`,
        }),
      ),
    );
  }
}
