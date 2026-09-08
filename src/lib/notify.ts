import { createSupabaseServiceClient } from '@/lib/db/server';
import { sendEmail } from '@/lib/email';
import { logger } from '@/lib/logger';
import { sendNotificationEvent } from '@/lib/notification-delivery';
import { fanOutPushNotification } from '@/lib/push/fanout';
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
  | 'integration_disconnected'
  | 'sla_warning'
  | 'sla_breach';

export interface NotifyResult {
  /**
   * Whether the `notifications` row was written. Callers that dedupe by reading
   * that row back (see below) can only treat an alert as delivered when this is
   * true — recording it as sent on a failed write is what re-arms the flood.
   */
  persisted: boolean;
  /** Whether the email / webhook / Slack / push fan-out was attempted. */
  delivered: boolean;
}

/**
 * THE ROW IS BOTH THE RECORD AND THE LOCK
 * ---------------------------------------
 * This insert used to be fire-and-forget — `await sb.from(...).insert({...})`
 * with the result discarded. supabase-js does not throw on a rejected write, it
 * returns `{ error }`, so a failed insert was indistinguishable from a
 * successful one and every channel below fanned out regardless.
 *
 * That is worse than a missing bell, because two callers derive
 * once-per-window from the row this function writes: `sendUsageAlerts`
 * (`@/lib/billing/usage-alerts`) and `notifyReplyGateBlocked`
 * (`@/lib/ai/inbound`) both ask "is there an `over_usage_limit` row carrying
 * this `data_json.reason` since the window opened?" and stay quiet if there is.
 * With the insert failing silently the answer is always no, so the cron re-sends
 * the same alarming email on every sweep for the rest of the month — exactly the
 * flood that dedupe exists to prevent.
 *
 * WHY A FAILED ROW SUPPRESSES THE FAN-OUT
 * ---------------------------------------
 * Delivering anyway is defensible: an alert nobody receives is information the
 * customer wanted. It was rejected on three grounds.
 *
 *  1. Nothing here is the only copy. Every caller writes its own record first
 *     and notifies afterwards — the lead row in `@/lib/tools/leads`, the order
 *     in `@/lib/tools/cart`, the ticket, the conversation, Stripe's own invoice.
 *     A notification that does not go out delays the news; it does not lose it.
 *  2. The two failures are not symmetric. A suppressed alert is retried by
 *     whatever produced it — the billing cron sweeps again, the next blocked
 *     reply asks again, dunning fires again — so the cost is bounded by one
 *     cycle. An email with no row behind it is unbounded: it repeats every cycle
 *     until the window rolls over, and the customer's remedy for that is a
 *     filter that sends everything we send to trash, taking the alerts that
 *     matter with it.
 *  3. An alert with no row is one the customer cannot act on. The dashboard
 *     bell, the notifications page and the target of the push deep link are all
 *     reads of this table; without the row they show nothing, and the email
 *     describes an event the product denies happened.
 *
 * The write failure is logged at `error`, which `@/lib/logger` also files into
 * `application_errors`, so a persistent breakage — a deleted company failing the
 * FK, a `data` payload Postgres will not take as jsonb — shows up on the
 * super-admin error screen instead of quietly eating alerts.
 *
 * It deliberately does NOT throw. `notify()` is awaited on request paths that
 * have already done their real work (`/api/widget/prechat`, the cart checkout
 * tool, the Stripe webhook), and throwing would turn a missing bell into a
 * failed lead capture or a 500 back to Stripe. Callers that care read the
 * returned `NotifyResult`; the many that do not are unaffected, which is why
 * this widened the return type rather than the parameter list.
 */
export async function notify(params: {
  companyId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  email?: boolean;
}): Promise<NotifyResult> {
  const sb = createSupabaseServiceClient();
  const { error: insertError } = await sb.from('notifications').insert({
    company_id: params.companyId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    data_json: params.data ?? {},
  });
  if (insertError) {
    logger.error('Notification row could not be written; suppressing its fan-out', {
      companyId: params.companyId,
      module: 'notify',
      type: params.type,
      error: insertError.message,
    });
    return { persisted: false, delivered: false };
  }

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

  // Web push to the dashboard PWA — a fifth delivery channel governed by the
  // same settings row. Self-guarding: never throws, never blocks the above.
  await fanOutPushNotification(params);

  if (params.email) {
    const { data: deliverySettings } = await sb
      .from('company_notification_settings')
      .select('company_id')
      .eq('company_id', params.companyId)
      .maybeSingle();
    // A company with a delivery-settings row has already been served by
    // `sendNotificationEvent` above, which owns its email channel. The row was
    // written either way, so this is a delivered notification, not a suppressed
    // one.
    if (deliverySettings) return { persisted: true, delivered: true };

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

  return { persisted: true, delivered: true };
}
