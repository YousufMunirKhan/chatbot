import { createHash } from 'crypto';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { encryptSecret } from '@/lib/crypto';
import { hasFeature } from '@/lib/entitlements';
import { hasScope, API_SCOPE_WILDCARD, type ApiScope } from '@/lib/api-keys';
import { ApiError } from '@/lib/api/handler';
import { dispatchWebhookEvent, maskUrl, newSigningSecret, type WebhookEvent } from '@/lib/webhooks';
import { logger } from '@/lib/logger';

/**
 * REST hooks — the subscribe/unsubscribe handshake Zapier, Make and n8n speak.
 *
 * A subscription is stored as a `webhook_endpoints` row of kind `rest_hook`
 * plus a `rest_hook_subscriptions` row that remembers who created it. That is
 * the whole trick: outbound delivery, HMAC signing, the retry, the per-plan
 * budget and the delivery log already exist in `@/lib/webhooks` and find their
 * destinations by querying `webhook_endpoints`, so a Zap is delivered to by the
 * same code as every other webhook and there is no second delivery path to keep
 * correct. Migration 0079 has the full reasoning.
 *
 * TENANT ISOLATION: every function here takes the company id resolved from the
 * API key by `withApiAuth` and filters on it. Nothing reads a company id out of
 * a request body.
 */

/** Ceiling per company, so one runaway Zap builder cannot mint endpoints forever. */
export const MAX_SUBSCRIPTIONS_PER_COMPANY = 25;

/**
 * The scope a key must hold to subscribe to each event.
 *
 * A hook subscription is a standing read of whatever the event carries, so it
 * has to cost the same scope reading that object costs. `withApiAuth` takes one
 * scope for a whole route, which cannot express "depends on the event", so the
 * route asks for the baseline scope and the event's own scope is checked here.
 *
 * An event missing from this map is not subscribable without the `*` wildcard —
 * a new event type added to the catalogue later must be classified deliberately
 * rather than inheriting whatever the last one happened to need.
 */
const EVENT_SCOPES: Record<string, ApiScope> = {
  'enquiry.created': 'contacts:read',
  'lead.created': 'contacts:read',
  'contact.created': 'contacts:read',
  'appointment.created': 'contacts:read',
  'conversation.created': 'conversations:read',
  'conversation.closed': 'conversations:read',
  'ticket.created': 'conversations:read',
  'ticket.resolved': 'conversations:read',
  'message.sent': 'conversations:read',
  'order.placed': 'orders:read',
  'order.created': 'orders:read',
  'broadcast.created': 'broadcasts:write',
};

/**
 * The events raised by migration 0079's triggers, which carry the whole record.
 * The Zapier app's four triggers subscribe to exactly these; the older
 * notification-shaped events remain subscribable for anyone who wants them.
 */
export const RICH_EVENTS = [
  'enquiry.created',
  'conversation.created',
  'conversation.closed',
  'order.placed',
] as const;

export interface RestHookSubscription {
  id: string;
  event: string;
  label: string | null;
  client: string;
  /** Enough of the target URL to recognise it. Never the whole credential. */
  target_url_preview: string;
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  created_at: string | null;
}

interface SubscriptionRow {
  id: string;
  event: string;
  label: string | null;
  client: string;
  target_url_preview: string;
  endpoint_id: string;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at: string | null;
}

function toSubscription(row: SubscriptionRow): RestHookSubscription {
  return {
    id: row.id,
    event: row.event,
    label: row.label,
    client: row.client,
    target_url_preview: row.target_url_preview,
    status: row.disabled_at ? 'disabled' : 'active',
    disabled_reason: row.disabled_reason,
    created_at: row.created_at,
  };
}

const SUBSCRIPTION_COLUMNS =
  'id,event,label,client,target_url_preview,endpoint_id,disabled_at,disabled_reason,created_at';

/** The idempotency key. The URL itself is only ever stored encrypted. */
function hashTargetUrl(url: string): string {
  return createHash('sha256').update(url.trim(), 'utf8').digest('hex');
}

/**
 * Hosts a target URL may not point at.
 *
 * Delivery never returns the response body to the subscriber, so this is not
 * the last line of defence against SSRF — but an API key should not be able to
 * aim a signed POST at the metadata service or at something inside the private
 * network, and every integration platform worth supporting hands out a public
 * HTTPS URL anyway.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host) || /^0\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/** Validate a `target_url` from a request body, or refuse it with a reason. */
export function parseTargetUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiError('invalid_request', '`target_url` must be an absolute URL.');
  }
  if (url.protocol !== 'https:') {
    throw new ApiError('invalid_request', '`target_url` must use https.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new ApiError('invalid_request', '`target_url` must be a public host.');
  }
  if (url.href.length > 1000) {
    throw new ApiError('invalid_request', '`target_url` is too long (1000 characters maximum).');
  }
  return url.href;
}

/**
 * Is `event` something this company's key may subscribe to?
 *
 * Two questions, and both answers matter to whoever is reading the error: the
 * event has to exist in the public catalogue (`webhook_event_types`, which
 * migration 0079 extends), and the key has to hold the scope that reading that
 * object costs.
 */
export async function assertEventSubscribable(scopes: string[], event: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('webhook_event_types')
    .select('event')
    .eq('event', event)
    .maybeSingle();
  if (!data) {
    throw new ApiError('invalid_request', `Unknown event \`${event}\`.`);
  }

  const required = EVENT_SCOPES[event];
  if (!required) {
    if (!scopes.includes(API_SCOPE_WILDCARD)) {
      throw new ApiError(
        'forbidden',
        `Subscribing to \`${event}\` needs an API key with full access.`,
      );
    }
    return;
  }
  if (!hasScope(scopes, required)) {
    throw new ApiError(
      'forbidden',
      `Subscribing to \`${event}\` needs the \`${required}\` scope.`,
    );
  }
}

export async function listRestHooks(companyId: string): Promise<RestHookSubscription[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('rest_hook_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    // TENANT ISOLATION: the key's company, never a request value.
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError('internal_error', 'Could not load your hook subscriptions.');
  return ((data ?? []) as unknown as SubscriptionRow[]).map(toSubscription);
}

/**
 * Subscribe a target URL to an event.
 *
 * Idempotent on (company, event, target URL): Zapier re-sends a subscribe every
 * time a Zap is edited and re-enabled, and a fresh row each time would mean the
 * customer's Zap firing twice, then three times. Re-subscribing instead revives
 * the existing row — including one the failure kill switch had disabled, which
 * is exactly how a customer fixes a Zap that broke while they were away.
 */
export async function subscribeRestHook(params: {
  companyId: string;
  apiKeyId: string;
  event: string;
  targetUrl: string;
  label?: string | null;
  client?: string | null;
}): Promise<RestHookSubscription> {
  const sb = createSupabaseServiceClient();
  const targetUrlHash = hashTargetUrl(params.targetUrl);
  const preview = maskUrl(params.targetUrl);
  const label = params.label?.slice(0, 120) ?? null;
  const client = (params.client ?? 'zapier').slice(0, 40);

  const { data: existing } = await sb
    .from('rest_hook_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('company_id', params.companyId)
    .eq('event', params.event)
    .eq('target_url_hash', targetUrlHash)
    .maybeSingle();

  if (existing) {
    const row = existing as unknown as SubscriptionRow;
    return reviveSubscription(row, { label, client, targetUrl: params.targetUrl, preview });
  }

  // The cap counts live subscriptions only, so a customer who has cleaned up
  // after themselves is never blocked by rows they already deleted.
  const { count } = await sb
    .from('rest_hook_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', params.companyId)
    .is('disabled_at', null);
  if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_COMPANY) {
    throw new ApiError(
      'conflict',
      `This account already has ${MAX_SUBSCRIPTIONS_PER_COMPANY} hook subscriptions. Delete one before adding another.`,
    );
  }

  // The endpoint row is the delivery vehicle: `dispatchWebhookEvent` finds it,
  // signs the body with `secret` and logs the result, all unchanged.
  const { data: endpoint, error: endpointError } = await sb
    .from('webhook_endpoints')
    .insert({
      company_id: params.companyId,
      kind: 'rest_hook',
      url_encrypted: encryptSecret(params.targetUrl),
      url_preview: preview,
      secret: newSigningSecret(),
      events: [params.event],
      active: true,
      label: label ?? `${client} — ${params.event}`,
    })
    .select('id')
    .single();
  if (endpointError || !endpoint) {
    throw new ApiError('internal_error', 'Could not register the hook.');
  }
  const endpointId = (endpoint as { id: string }).id;

  const { data: created, error: subscriptionError } = await sb
    .from('rest_hook_subscriptions')
    .insert({
      company_id: params.companyId,
      event: params.event,
      target_url_hash: targetUrlHash,
      target_url_preview: preview,
      endpoint_id: endpointId,
      api_key_id: params.apiKeyId,
      client,
      label,
    })
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  if (subscriptionError || !created) {
    // Never leave an endpoint nobody owns: it would keep receiving deliveries
    // with no subscription row to unsubscribe it by.
    await sb
      .from('webhook_endpoints')
      .delete()
      .eq('id', endpointId)
      .eq('company_id', params.companyId);

    // Two subscribes for the same Zap raced. The unique index did its job —
    // return the row the other request created rather than an error the caller
    // can do nothing about.
    const { data: raced } = await sb
      .from('rest_hook_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('company_id', params.companyId)
      .eq('event', params.event)
      .eq('target_url_hash', targetUrlHash)
      .maybeSingle();
    if (raced) {
      return reviveSubscription(raced as unknown as SubscriptionRow, {
        label,
        client,
        targetUrl: params.targetUrl,
        preview,
      });
    }
    throw new ApiError('internal_error', 'Could not register the hook.');
  }

  return toSubscription(created as unknown as SubscriptionRow);
}

/** Bring an existing (possibly disabled) subscription and its endpoint back. */
async function reviveSubscription(
  row: SubscriptionRow,
  next: { label: string | null; client: string; targetUrl: string; preview: string },
): Promise<RestHookSubscription> {
  const sb = createSupabaseServiceClient();

  await sb
    .from('webhook_endpoints')
    .update({
      active: true,
      // Without this reset a revived subscription would arrive already at the
      // five-failure ceiling migration 0079 disables on, and the next single
      // failed delivery would switch it straight back off.
      failure_count: 0,
      events: [row.event],
      url_encrypted: encryptSecret(next.targetUrl),
      url_preview: next.preview,
      label: next.label ?? `${next.client} — ${row.event}`,
    })
    .eq('id', row.endpoint_id);

  const { data: updated } = await sb
    .from('rest_hook_subscriptions')
    .update({
      disabled_at: null,
      disabled_reason: null,
      label: next.label,
      client: next.client,
      target_url_preview: next.preview,
    })
    .eq('id', row.id)
    .select(SUBSCRIPTION_COLUMNS)
    .single();

  return toSubscription((updated ?? row) as unknown as SubscriptionRow);
}

/**
 * Unsubscribe. Deleting the endpoint row is what actually stops delivery; the
 * subscription row goes with it through the foreign key's cascade.
 */
export async function unsubscribeRestHook(params: {
  companyId: string;
  id: string;
}): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('rest_hook_subscriptions')
    .select('id,endpoint_id')
    // TENANT ISOLATION: an id belonging to another company must read as absent.
    .eq('company_id', params.companyId)
    .eq('id', params.id)
    .maybeSingle();
  if (!data) return false;

  const row = data as { id: string; endpoint_id: string };
  await sb.from('webhook_endpoints').delete().eq('id', row.endpoint_id).eq('company_id', params.companyId);
  // Belt and braces: if the endpoint had already been deleted by hand from
  // Company → Webhooks, the cascade has nothing to do and this finishes the job.
  await sb.from('rest_hook_subscriptions').delete().eq('id', row.id).eq('company_id', params.companyId);
  return true;
}

/**
 * The last few real records for an event, shaped exactly like the hook payload.
 *
 * Zapier will not let anyone finish a Zap without seeing a record from their own
 * account, and a hook that has not fired yet has nothing to show. The shaping is
 * done by the same SQL the triggers use (migration 0079) so the sample and the
 * real delivery cannot disagree about field names.
 */
export async function restHookSamples(
  companyId: string,
  event: string,
  limit = 3,
): Promise<Array<Record<string, unknown>>> {
  // Only the four events raised from the tables have records to sample. The
  // older notification-shaped events are assembled at the moment they fire and
  // exist nowhere to be read back, so say that rather than answering with an
  // empty list an integrator would read as "this account has no data".
  if (!(RICH_EVENTS as readonly string[]).includes(event)) {
    throw new ApiError(
      'invalid_request',
      `Sample records are only available for: ${RICH_EVENTS.join(', ')}.`,
    );
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc('rest_hook_samples', {
    p_company_id: companyId,
    p_event: event,
    p_limit: limit,
  });
  if (error) {
    logger.warn('REST hook samples failed', {
      module: 'api/v1/hooks',
      companyId,
      event,
      error: error.message,
    });
    return [];
  }
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export interface DrainResult {
  claimed: number;
  dispatched: number;
  disabledCompanies: number;
  pruned: number;
}

/** One pass, so a backlog drains over several runs instead of one long request. */
const DRAIN_LIMIT = 100;
/** Delivered rows are kept briefly as a debugging window, then dropped. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Deliveries in flight at once. Each is an HTTPS round trip with one retry. */
const DRAIN_CONCURRENCY = 5;

interface OutboxRow {
  id: number;
  company_id: string;
  event: string;
  title: string | null;
  body: string | null;
  payload_json: Record<string, unknown> | null;
}

/**
 * Deliver everything migration 0079's triggers have queued.
 *
 * Rows are CLAIMED before they are delivered, and the claim is the same
 * statement that reads them back — so two overlapping runs cannot both take the
 * same event, and a process that dies mid-delivery drops one event rather than
 * replaying it. A replayed event means a duplicate Zap run: a second invoice, a
 * second CRM record, a second email to a customer. Losing one is the better
 * failure, and the delivery log says which endpoints were tried.
 */
export async function drainRestHookEvents(limit = DRAIN_LIMIT): Promise<DrainResult> {
  const sb = createSupabaseServiceClient();
  const result: DrainResult = { claimed: 0, dispatched: 0, disabledCompanies: 0, pruned: 0 };

  const { data: pending, error: readError } = await sb
    .from('rest_hook_events')
    .select('id')
    .is('claimed_at', null)
    .order('id', { ascending: true })
    .limit(limit);
  if (readError) throw new Error(readError.message);

  const ids = ((pending ?? []) as Array<{ id: number }>).map((row) => row.id);
  if (ids.length > 0) {
    const { data: claimed, error: claimError } = await sb
      .from('rest_hook_events')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', ids)
      // Only rows still unclaimed come back, which is what makes this a claim
      // rather than a hopeful update.
      .is('claimed_at', null)
      .select('id,company_id,event,title,body,payload_json');
    if (claimError) throw new Error(claimError.message);

    const rows = (claimed ?? []) as unknown as OutboxRow[];
    result.claimed = rows.length;

    // A company that has lost API access must stop receiving hook deliveries —
    // the subscription is part of the paid feature. Its own webhook endpoints
    // are not, so the event still goes out and only the `rest_hook` rows are
    // switched off. Memoised: one entitlement lookup per company per run.
    const entitlement = new Map<string, boolean>();
    for (const row of rows) {
      if (entitlement.has(row.company_id)) continue;
      const entitled = await hasFeature(row.company_id, 'api_access');
      entitlement.set(row.company_id, entitled);
      if (!entitled) {
        await disableSubscriptionsForCompany(
          row.company_id,
          'Disabled automatically: this account no longer includes API access.',
        );
        result.disabledCompanies++;
      }
    }

    for (let i = 0; i < rows.length; i += DRAIN_CONCURRENCY) {
      const batch = rows.slice(i, i + DRAIN_CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          try {
            await dispatchWebhookEvent({
              companyId: row.company_id,
              // The four events raised by 0079 are catalogued in
              // `webhook_event_types` but are not part of the five-name union
              // `@/lib/webhooks` is typed against. Widened here, at one
              // documented boundary, exactly as `developer-events.ts` does for
              // the events the public API produces.
              event: row.event as WebhookEvent,
              title: row.title ?? row.event,
              body: row.body ?? undefined,
              data: row.payload_json ?? {},
            });
            result.dispatched++;
          } catch (err) {
            // `dispatchWebhookEvent` swallows its own failures; this only
            // catches the unexpected, and one bad row must not strand the rest.
            logger.warn('REST hook delivery failed', {
              module: 'api/v1/hooks',
              companyId: row.company_id,
              event: row.event,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );
    }
  }

  const { data: pruned } = await sb
    .from('rest_hook_events')
    .delete()
    .lt('claimed_at', new Date(Date.now() - PRUNE_AFTER_MS).toISOString())
    .select('id');
  result.pruned = ((pruned ?? []) as Array<{ id: number }>).length;

  return result;
}

/** Switch off every live subscription a company holds, with a reason. */
async function disableSubscriptionsForCompany(companyId: string, reason: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('rest_hook_subscriptions')
    .update({ disabled_at: new Date().toISOString(), disabled_reason: reason })
    .eq('company_id', companyId)
    .is('disabled_at', null)
    .select('endpoint_id');
  const endpointIds = ((data ?? []) as Array<{ endpoint_id: string }>).map((row) => row.endpoint_id);
  if (endpointIds.length === 0) return;
  await sb
    .from('webhook_endpoints')
    .update({ active: false })
    .in('id', endpointIds)
    .eq('company_id', companyId);
}
