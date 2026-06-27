import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { dispatchWebhookEvent, NOTIFICATION_TO_EVENT } from '@/lib/webhooks';

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
  if (webhookEvent) {
    await dispatchWebhookEvent({
      companyId: params.companyId,
      event: webhookEvent,
      title: params.title,
      body: params.body,
      data: params.data,
    });
  }

  if (params.email) {
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
