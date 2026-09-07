import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { errorMessage } from '@/lib/application-errors';
import { encryptPushPayload } from './encrypt';
import { getVapidKeys, isPushConfigured, vapidAuthorizationHeader, type VapidKeys } from './vapid';

/**
 * Web Push delivery for the dashboard PWA.
 *
 * This is a delivery *channel*, not a notification system: something else
 * decides an agent should be told, and this module gets the message onto their
 * lock screen. Two entry points — one person (`sendPushToUser`) or everyone in
 * a company (`sendPushToCompany`).
 *
 * Built entirely on `node:crypto` (see ./vapid and ./encrypt); adding a Web
 * Push library was not necessary.
 */

export interface PushPayload {
  title: string;
  body?: string;
  /** In-app path the notification opens. Must be same-origin and start with '/'. */
  url?: string;
  /** Collapse key — a second alert for the same conversation replaces the first. */
  tag?: string;
  /** The originating NotificationType, carried through for client-side filtering. */
  type?: string;
  conversationId?: string;
  data?: Record<string, unknown>;
}

export interface PushSubscriptionRecord {
  id: string;
  companyId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failedCount: number;
}

export interface PushSendResult {
  endpoint: string;
  ok: boolean;
  statusCode: number | null;
  pruned: boolean;
  error?: string;
}

export interface PushFanOutResult {
  configured: boolean;
  attempted: number;
  delivered: number;
  pruned: number;
}

/**
 * A push service answering 404 (Not Found) or 410 (Gone) is telling us the
 * subscription no longer exists — the user cleared site data, uninstalled the
 * PWA, or the browser rotated it. That is permanent, so the row is deleted.
 * Everything else (429, 500, a network error) is transient and only increments
 * `failed_count`; deleting on those would silently unsubscribe healthy devices
 * during a push-service outage.
 */
export function shouldPruneSubscription(statusCode: number | null): boolean {
  return statusCode === 404 || statusCode === 410;
}

/** Failure budget before a chronically failing device is dropped anyway. */
export const MAX_CONSECUTIVE_FAILURES = 10;

export function isSuccessStatus(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 200 && statusCode < 300;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return value;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Push services cap the encrypted record at 4096 bytes, so the JSON has to stay
 * small. Titles and bodies are clipped rather than the whole notification being
 * dropped for being one sentence too long.
 */
export function serializePayload(payload: PushPayload): string {
  return JSON.stringify({
    title: truncate(payload.title, 120) ?? '',
    body: truncate(payload.body, 400),
    url: payload.url,
    tag: payload.tag,
    type: payload.type,
    conversationId: payload.conversationId,
    data: payload.data,
  });
}

/** POST one encrypted notification to one push endpoint. Never throws. */
export async function sendWebPush(
  subscription: Pick<PushSubscriptionRecord, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushPayload,
  options?: { keys?: VapidKeys; ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' },
): Promise<PushSendResult> {
  const keys = options?.keys ?? getVapidKeys();
  if (!keys) {
    return { endpoint: subscription.endpoint, ok: false, statusCode: null, pruned: false, error: 'vapid_not_configured' };
  }

  try {
    const body = encryptPushPayload(serializePayload(payload), subscription);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorizationHeader({ endpoint: subscription.endpoint, keys }),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options?.ttlSeconds ?? 6 * 60 * 60),
        Urgency: options?.urgency ?? 'high',
      },
      body: new Uint8Array(body),
    });
    return {
      endpoint: subscription.endpoint,
      ok: isSuccessStatus(res.status),
      statusCode: res.status,
      pruned: shouldPruneSubscription(res.status),
      error: isSuccessStatus(res.status) ? undefined : `push_service_${res.status}`,
    };
  } catch (err) {
    // A DNS failure or a torn connection is transient by definition.
    return {
      endpoint: subscription.endpoint,
      ok: false,
      statusCode: null,
      pruned: false,
      error: errorMessage(err),
    };
  }
}

function mapSubscription(row: Record<string, unknown>): PushSubscriptionRecord {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    userId: row.user_id as string,
    endpoint: row.endpoint as string,
    p256dh: row.p256dh as string,
    auth: row.auth as string,
    failedCount: Number(row.failed_count ?? 0),
  };
}

async function recordOutcome(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
  result: PushSendResult,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const prune = result.pruned || (!result.ok && subscription.failedCount + 1 >= MAX_CONSECUTIVE_FAILURES);

  if (prune) {
    await sb
      .from('push_subscriptions')
      .delete()
      .eq('id', subscription.id)
      .eq('company_id', subscription.companyId); // scope guard
  } else if (result.ok) {
    await sb
      .from('push_subscriptions')
      .update({ last_seen_at: new Date().toISOString(), failed_count: 0 })
      .eq('id', subscription.id)
      .eq('company_id', subscription.companyId);
  } else {
    await sb
      .from('push_subscriptions')
      .update({ failed_count: subscription.failedCount + 1 })
      .eq('id', subscription.id)
      .eq('company_id', subscription.companyId);
  }

  await sb.from('push_delivery_log').insert({
    company_id: subscription.companyId,
    user_id: subscription.userId,
    subscription_id: prune ? null : subscription.id,
    event_type: payload.type ?? 'push',
    status: prune ? 'pruned' : result.ok ? 'sent' : 'failed',
    status_code: result.statusCode,
    error: result.error ?? null,
  });
}

async function deliver(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
): Promise<PushFanOutResult> {
  if (!isPushConfigured()) {
    return { configured: false, attempted: 0, delivered: 0, pruned: 0 };
  }
  if (subscriptions.length === 0) {
    return { configured: true, attempted: 0, delivered: 0, pruned: 0 };
  }

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const result = await sendWebPush(subscription, payload);
      await recordOutcome(subscription, payload, result);
      return result;
    }),
  );

  let delivered = 0;
  let pruned = 0;
  for (const settled of results) {
    if (settled.status !== 'fulfilled') continue;
    if (settled.value.ok) delivered += 1;
    if (settled.value.pruned) pruned += 1;
  }
  return { configured: true, attempted: subscriptions.length, delivered, pruned };
}

/** Push to every device one person has registered. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushFanOutResult> {
  if (!isPushConfigured()) return { configured: false, attempted: 0, delivered: 0, pruned: 0 };
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb.from('push_subscriptions').select('*').eq('user_id', userId);
    return await deliver((data ?? []).map((row) => mapSubscription(row as Record<string, unknown>)), payload);
  } catch (err) {
    logger.warn('Push fan-out to user failed', { module: 'push', error: errorMessage(err) });
    return { configured: true, attempted: 0, delivered: 0, pruned: 0 };
  }
}

/**
 * Push to everyone in a company. `excludeUserId` keeps the person who caused
 * the event (the agent who took a conversation over) from being buzzed by their
 * own action.
 */
export async function sendPushToCompany(
  companyId: string,
  payload: PushPayload,
  opts?: { excludeUserId?: string; userIds?: string[] },
): Promise<PushFanOutResult> {
  if (!isPushConfigured()) return { configured: false, attempted: 0, delivered: 0, pruned: 0 };
  try {
    const sb = createSupabaseServiceClient();
    let query = sb.from('push_subscriptions').select('*').eq('company_id', companyId);
    if (opts?.userIds?.length) query = query.in('user_id', opts.userIds);
    const { data } = await query;
    const subscriptions = (data ?? [])
      .map((row) => mapSubscription(row as Record<string, unknown>))
      .filter((sub) => sub.userId !== opts?.excludeUserId);
    return await deliver(subscriptions, payload);
  } catch (err) {
    logger.warn('Push fan-out to company failed', {
      companyId,
      module: 'push',
      error: errorMessage(err),
    });
    return { configured: true, attempted: 0, delivered: 0, pruned: 0 };
  }
}

export { isPushConfigured, getVapidKeys };
