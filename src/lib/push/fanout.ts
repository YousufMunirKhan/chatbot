import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { errorMessage } from '@/lib/application-errors';
import { sendPushToCompany, type PushPayload } from './index';
import { isPushConfigured } from './vapid';

/**
 * Turns an in-app notification into a lock-screen notification.
 *
 * This lives outside `src/lib/notify.ts` on purpose: `notify()` is called from
 * dozens of places and already fans out to four channels, so push joins it as a
 * single guarded line rather than as more branching inside it.
 *
 * Settings are the ones the company already configured. `notifications_enabled`
 * is the master switch, and `event_rules_json.<event>.push` is the per-event
 * toggle the "Who gets told" grid writes — push is a fifth column there, not a
 * parallel settings system. Events that predate that grid (the SLA alerts) fall
 * back to the priority list below.
 */

/**
 * Events worth interrupting someone for. A push notification costs the user
 * attention, so the default set is the five that mean "a person is waiting or
 * money is on the table" — not every audit trail entry.
 */
export const PUSH_PRIORITY_EVENTS = [
  'human_takeover',
  'new_lead',
  'sla_breach',
  'sla_warning',
  'new_order',
] as const;

export interface PushEventSettings {
  notificationsEnabled: boolean;
  eventRules: Record<string, Record<string, boolean>>;
}

/**
 * Pure decision: should this event become a push notification?
 * An explicit per-event rule always wins; otherwise only priority events push.
 */
export function pushAllowedForEvent(settings: PushEventSettings | null, eventType: string): boolean {
  // No settings row at all means the company never opened the delivery screen.
  // Push still works for the priority events — the master switch defaults on.
  if (settings && !settings.notificationsEnabled) return false;
  const rule = settings?.eventRules?.[eventType]?.push;
  if (typeof rule === 'boolean') return rule;
  return (PUSH_PRIORITY_EVENTS as readonly string[]).includes(eventType);
}

const EVENT_ROUTES: Record<string, string> = {
  new_lead: '/company/leads',
  new_order: '/company/orders',
  new_appointment: '/company/appointments',
  helpdesk_issue_reported: '/company/help-desk',
  helpdesk_issue_resolved: '/company/help-desk',
  failed_payment: '/company/billing',
  over_usage_limit: '/company/billing',
  integration_disconnected: '/company/integrations',
  failed_sync: '/company/integrations',
  sla_breach: '/company/inbox',
  sla_warning: '/company/inbox',
  human_takeover: '/company/inbox',
};

/**
 * Where the notification should land when tapped. A conversation id always
 * wins — an agent tapping "a customer asked for a human" wants the thread, not
 * a list — and the fallback is the notification centre rather than the
 * dashboard home, so no tap is ever a dead end.
 */
export function pushTargetUrl(eventType: string, data?: Record<string, unknown>): string {
  const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : null;
  if (conversationId) return `/company/inbox/${conversationId}`;
  return EVENT_ROUTES[eventType] ?? '/company/notifications';
}

/** Pure payload construction, so the shape is testable without a push service. */
export function buildPushPayload(params: {
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}): PushPayload {
  const conversationId = typeof params.data?.conversationId === 'string' ? params.data.conversationId : undefined;
  return {
    title: params.title,
    body: params.body ?? undefined,
    url: pushTargetUrl(params.type, params.data),
    // Collapsing on the conversation (or the event type) means five SLA
    // warnings for one thread replace each other instead of stacking five
    // banners on a phone.
    tag: conversationId ? `conversation:${conversationId}` : `event:${params.type}`,
    type: params.type,
    conversationId,
  };
}

async function loadPushSettings(companyId: string): Promise<PushEventSettings | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('company_notification_settings')
    .select('notifications_enabled,event_rules_json')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    notificationsEnabled: row.notifications_enabled !== false,
    eventRules:
      row.event_rules_json && typeof row.event_rules_json === 'object'
        ? (row.event_rules_json as Record<string, Record<string, boolean>>)
        : {},
  };
}

/**
 * The one call `notify()` makes. Guarded end-to-end: a push failure must never
 * take down the in-app notification that already succeeded.
 */
export async function fanOutPushNotification(params: {
  companyId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    if (!isPushConfigured()) return;
    const settings = await loadPushSettings(params.companyId);
    if (!pushAllowedForEvent(settings, params.type)) return;
    await sendPushToCompany(params.companyId, buildPushPayload(params));
  } catch (err) {
    logger.warn('Push notification fan-out failed', {
      companyId: params.companyId,
      module: 'push',
      error: errorMessage(err),
    });
  }
}
