import { createSupabaseServiceClient } from '@/lib/db/server';
import { dispatchWebhookEvent, type WebhookEvent } from '@/lib/webhooks';
import { logger } from '@/lib/logger';

/**
 * Developer-facing view of the outbound webhook system.
 *
 * The delivery machinery lives in `@/lib/webhooks` and is not touched here.
 * This module adds only what a *developer* needs on top of it: the public
 * catalogue of event names (migration 0056 `webhook_event_types`), a way to
 * fire the events the public API itself produces, and a "send test event"
 * helper for the developer console.
 *
 * `dispatchWebhookEvent` is typed against the five events the internal product
 * emits. The catalogue is a superset (API-produced events were added in 0056),
 * so the event name is widened at this single, documented boundary rather than
 * by editing the shared library.
 */

export interface WebhookEventType {
  event: string;
  label: string;
  description: string;
  sample: Record<string, unknown>;
}

/** The public event catalogue, ordered so related events sit together. */
export async function listWebhookEventTypes(): Promise<WebhookEventType[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('webhook_event_types')
    .select('event,label,description,sample_json')
    .order('event', { ascending: true });
  if (error) {
    logger.warn('Webhook event catalogue unavailable', { error: error.message });
    return [];
  }
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      event: r.event as string,
      label: r.label as string,
      description: (r.description as string) ?? '',
      sample: (r.sample_json as Record<string, unknown>) ?? {},
    };
  });
}

/** Events the public API produces itself (documented in `docs/PUBLIC_API.md`). */
export const API_PRODUCED_EVENTS = ['contact.created', 'message.sent', 'broadcast.created'] as const;
export type ApiProducedEvent = (typeof API_PRODUCED_EVENTS)[number];

/**
 * Fire one of the API-produced events. Best-effort: a webhook problem must
 * never fail the API call that triggered it (`dispatchWebhookEvent` already
 * swallows its own errors, and the extra guard covers an unexpected throw).
 */
export async function dispatchDeveloperEvent(params: {
  companyId: string;
  event: ApiProducedEvent;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await dispatchWebhookEvent({
      companyId: params.companyId,
      event: params.event as WebhookEvent,
      title: params.title,
      body: params.body,
      data: params.data,
    });
  } catch (err) {
    logger.warn('Developer event dispatch failed', {
      companyId: params.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface TestEventResult {
  ok: boolean;
  /** Active endpoints subscribed to the event at the time of the send. */
  endpoints: number;
  message: string;
}

/**
 * Send the catalogue's sample payload for one event to every active endpoint
 * subscribed to it. Nothing is subscribed → say so instead of silently
 * "succeeding", which is the single most confusing outcome of a test button.
 */
export async function sendTestEvent(companyId: string, event: string): Promise<TestEventResult> {
  const sb = createSupabaseServiceClient();

  const { data: known } = await sb
    .from('webhook_event_types')
    .select('event,sample_json')
    .eq('event', event)
    .maybeSingle();
  if (!known) return { ok: false, endpoints: 0, message: 'Unknown event type.' };

  const { count } = await sb
    .from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('active', true)
    .contains('events', [event]);
  if (!count) {
    return {
      ok: false,
      endpoints: 0,
      message: `No active endpoint is subscribed to ${event}. Add one above first.`,
    };
  }

  const sample = ((known as Record<string, unknown>).sample_json as Record<string, unknown>) ?? {};
  await dispatchWebhookEvent({
    companyId,
    event: event as WebhookEvent,
    title: `Test event: ${event}`,
    body: 'This is a test event sent from your developer console.',
    data: { ...sample, test: true },
  });

  return {
    ok: true,
    endpoints: count,
    message: `Test ${event} sent to ${count} endpoint${count === 1 ? '' : 's'}. Check the delivery log.`,
  };
}
