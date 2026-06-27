import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCompanyId } from './data';
import { getWebhookUsage, type WebhookLimits } from '@/lib/webhooks';

/**
 * Webhooks data layer. All queries are scoped to the SESSION user's own company.
 */

export interface WebhookEndpointRow {
  id: string;
  kind: 'generic' | 'slack';
  urlPreview: string;
  events: string[];
  active: boolean;
  label: string | null;
  secret: string | null;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  failureCount: number;
  createdAt: string;
}

export async function listWebhookEndpoints(): Promise<WebhookEndpointRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('webhook_endpoints')
    .select(
      'id,kind,url_preview,events,active,label,secret,last_delivery_at,last_status,failure_count,created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      kind: (x.kind as 'generic' | 'slack') ?? 'generic',
      urlPreview: (x.url_preview as string) ?? '',
      events: (x.events as string[]) ?? [],
      active: Boolean(x.active),
      label: (x.label as string) ?? null,
      secret: (x.secret as string) ?? null,
      lastDeliveryAt: (x.last_delivery_at as string) ?? null,
      lastStatus: (x.last_status as string) ?? null,
      failureCount: Number(x.failure_count ?? 0),
      createdAt: x.created_at as string,
    };
  });
}

export interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  createdAt: string;
}

export async function recentDeliveries(limit = 20): Promise<DeliveryRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('webhook_deliveries')
    .select('id,event,status,status_code,attempts,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id as string,
      event: x.event as string,
      status: x.status as string,
      statusCode: (x.status_code as number) ?? null,
      attempts: Number(x.attempts ?? 1),
      createdAt: x.created_at as string,
    };
  });
}

export async function webhookUsage(): Promise<{
  used: number;
  limits: WebhookLimits;
  plan: string | null;
  endpointCount: number;
}> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const usage = await getWebhookUsage(companyId);
  const { count } = await sb
    .from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  return { ...usage, endpointCount: count ?? 0 };
}
