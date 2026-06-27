import { createHmac, randomBytes } from 'crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { getSubscription } from '@/lib/billing';
import { logger } from '@/lib/logger';

/**
 * Outbound webhooks (company integrations). Companies push events into their own
 * systems — a generic signed webhook (also consumable by Zapier/Make → 5,000+
 * apps), or Slack. Deliveries are metered per plan to bound server cost.
 */

export const WEBHOOK_EVENTS = ['lead.created', 'appointment.created', 'order.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Map an internal notification type → public webhook event name. */
export const NOTIFICATION_TO_EVENT: Record<string, WebhookEvent> = {
  new_lead: 'lead.created',
  new_appointment: 'appointment.created',
  new_order: 'order.created',
};

/**
 * Per-plan delivery budget (monthly) + max endpoints. Keeps server cost bounded:
 * webhooks fire on every lead/appointment/order, so a free account can't hammer
 * us. `null` = unlimited (custom/enterprise).
 */
export interface WebhookLimits {
  monthly: number | null;
  maxEndpoints: number;
}
export function planWebhookLimits(plan: string | null | undefined): WebhookLimits {
  switch (plan) {
    case 'starter':
      return { monthly: 1_000, maxEndpoints: 2 };
    case 'growth':
      return { monthly: 10_000, maxEndpoints: 5 };
    case 'pro':
      return { monthly: 50_000, maxEndpoints: 10 };
    case 'custom':
      return { monthly: null, maxEndpoints: 25 };
    default: // free_trial / none
      return { monthly: 100, maxEndpoints: 1 };
  }
}

function monthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Counted deliveries (success + failed; skipped does not count) this month. */
export async function getWebhookUsage(
  companyId: string,
): Promise<{ used: number; limits: WebhookLimits; plan: string | null }> {
  const sb = createSupabaseServiceClient();
  const sub = await getSubscription(companyId);
  const limits = planWebhookLimits(sub?.plan);
  const { count } = await sb
    .from('webhook_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('status', ['success', 'failed'])
    .gte('created_at', monthStart());
  return { used: count ?? 0, limits, plan: sub?.plan ?? null };
}

export function newSigningSecret(): string {
  return 'whsec_' + randomBytes(24).toString('hex');
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 8 ? '…' + u.pathname.slice(-6) : u.pathname;
    return `${u.protocol}//${u.host}${tail}`;
  } catch {
    return url.slice(0, 24) + '…';
  }
}

interface EndpointRow {
  id: string;
  kind: 'generic' | 'slack';
  url_encrypted: string;
  secret: string | null;
}

async function postOnce(url: string, headers: Record<string, string>, body: string, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ac.signal });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function deliver(
  endpoint: EndpointRow,
  event: WebhookEvent,
  envelope: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; attempts: number }> {
  let url: string;
  try {
    url = decryptSecret(endpoint.url_encrypted);
  } catch {
    return { ok: false, status: 0, attempts: 0 };
  }

  let headers: Record<string, string>;
  let body: string;
  if (endpoint.kind === 'slack') {
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({ text: slackText(event, envelope) });
  } else {
    body = JSON.stringify(envelope);
    headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event,
      'User-Agent': 'AI-Assistant-Webhooks/1',
    };
    if (endpoint.secret) {
      const sig = createHmac('sha256', endpoint.secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${sig}`;
    }
  }

  // One retry on transient failure (short backoff) — kept small so we never add
  // meaningful latency to the request that triggered the event.
  let attempts = 0;
  let last = { ok: false, status: 0 };
  for (let i = 0; i < 2; i++) {
    attempts++;
    last = await postOnce(url, headers, body);
    if (last.ok) break;
    if (i === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return { ...last, attempts };
}

function slackText(event: WebhookEvent, env: Record<string, unknown>): string {
  const icon = event === 'order.created' ? '🛒' : event === 'appointment.created' ? '📅' : '🎉';
  const title = (env.title as string) ?? event;
  const body = (env.body as string) ?? '';
  return `${icon} *${title}*\n${body}`.trim();
}

/**
 * Fire an event to all matching active endpoints for a company. Best-effort and
 * fully guarded — a webhook failure must never break the action that triggered
 * it. Enforces the monthly delivery budget for the plan.
 */
export async function dispatchWebhookEvent(params: {
  companyId: string;
  event: WebhookEvent;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = createSupabaseServiceClient();
    const { data: endpoints } = await sb
      .from('webhook_endpoints')
      .select('id,kind,url_encrypted,secret')
      .eq('company_id', params.companyId)
      .eq('active', true)
      .contains('events', [params.event]);
    if (!endpoints || endpoints.length === 0) return;

    const { used, limits } = await getWebhookUsage(params.companyId);
    const overBudget = limits.monthly != null && used >= limits.monthly;

    const envelope = {
      event: params.event,
      created_at: new Date().toISOString(),
      company_id: params.companyId,
      title: params.title,
      body: params.body,
      data: params.data ?? {},
    };

    await Promise.all(
      (endpoints as EndpointRow[]).map(async (ep) => {
        if (overBudget) {
          await recordDelivery(params.companyId, ep.id, params.event, 'skipped', null, 0);
          return;
        }
        const result = await deliver(ep, params.event, envelope);
        await recordDelivery(
          params.companyId,
          ep.id,
          params.event,
          result.ok ? 'success' : 'failed',
          result.status || null,
          result.attempts,
        );
        await sb
          .from('webhook_endpoints')
          .update({
            last_delivery_at: new Date().toISOString(),
            last_status: result.ok ? 'success' : 'failed',
            failure_count: result.ok ? 0 : (await currentFailures(ep.id)) + 1,
          })
          .eq('id', ep.id);
      }),
    );
  } catch (err) {
    logger.error('Webhook dispatch failed', {
      companyId: params.companyId,
      event: params.event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Send a sample event to ONE endpoint (used by the "Test" button). */
export async function sendTestWebhook(
  companyId: string,
  endpointId: string,
): Promise<{ ok: boolean; status: number }> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('webhook_endpoints')
    .select('id,kind,url_encrypted,secret')
    .eq('company_id', companyId)
    .eq('id', endpointId)
    .maybeSingle();
  if (!data) return { ok: false, status: 0 };
  const envelope = {
    event: 'lead.created' as WebhookEvent,
    created_at: new Date().toISOString(),
    company_id: companyId,
    title: 'Test webhook',
    body: 'This is a test event from your AI assistant.',
    data: { test: true, name: 'Test Customer', email: 'test@example.com' },
  };
  const result = await deliver(data as EndpointRow, 'lead.created', envelope);
  await recordDelivery(
    companyId,
    endpointId,
    'lead.created',
    result.ok ? 'success' : 'failed',
    result.status || null,
    result.attempts,
  );
  await sb
    .from('webhook_endpoints')
    .update({
      last_delivery_at: new Date().toISOString(),
      last_status: result.ok ? 'success' : 'failed',
    })
    .eq('id', endpointId);
  return { ok: result.ok, status: result.status };
}

async function currentFailures(endpointId: string): Promise<number> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('webhook_endpoints')
    .select('failure_count')
    .eq('id', endpointId)
    .maybeSingle();
  return Number((data as { failure_count?: number } | null)?.failure_count ?? 0);
}

async function recordDelivery(
  companyId: string,
  endpointId: string,
  event: string,
  status: 'success' | 'failed' | 'skipped',
  statusCode: number | null,
  attempts: number,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('webhook_deliveries').insert({
    company_id: companyId,
    endpoint_id: endpointId,
    event,
    status,
    status_code: statusCode,
    attempts,
  });
}
