import { createSupabaseServiceClient } from '@/lib/db/server';
import { listWebhookEventTypes, type WebhookEventType } from '@/lib/api/developer-events';
import { getCompanyId } from './data';

/**
 * Developer console data layer (public API + webhooks).
 *
 * Every query is scoped to the session user's own company via `getCompanyId()`
 * — never a value taken from the request.
 */

export interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Derived: revoked, expired, or live. */
  state: 'live' | 'revoked' | 'expired';
}

function keyState(revokedAt: string | null, expiresAt: string | null): ApiKeyRow['state'] {
  if (revokedAt) return 'revoked';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return 'expired';
  return 'live';
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('api_keys')
    .select('id,name,key_prefix,scopes,last_used_at,expires_at,revoked_at,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const revokedAt = (r.revoked_at as string) ?? null;
    const expiresAt = (r.expires_at as string) ?? null;
    return {
      id: r.id as string,
      name: (r.name as string) ?? 'API key',
      keyPrefix: r.key_prefix as string,
      scopes: (r.scopes as string[]) ?? [],
      lastUsedAt: (r.last_used_at as string) ?? null,
      expiresAt,
      revokedAt,
      createdAt: r.created_at as string,
      state: keyState(revokedAt, expiresAt),
    };
  });
}

export interface ApiRequestLogRow {
  id: string;
  method: string;
  path: string;
  status: number;
  durationMs: number | null;
  ip: string | null;
  createdAt: string;
  keyName: string | null;
  keyPrefix: string | null;
}

export async function recentApiRequests(limit = 25): Promise<ApiRequestLogRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('api_request_logs')
    .select('id,method,path,status,duration_ms,ip,created_at,api_keys(name,key_prefix)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const joined = r.api_keys as { name?: string; key_prefix?: string } | Array<{ name?: string; key_prefix?: string }> | null;
    const key = Array.isArray(joined) ? joined[0] : joined;
    return {
      id: String(r.id),
      method: r.method as string,
      path: r.path as string,
      status: Number(r.status ?? 0),
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      ip: (r.ip as string) ?? null,
      createdAt: r.created_at as string,
      keyName: key?.name ?? null,
      keyPrefix: key?.key_prefix ?? null,
    };
  });
}

export interface ApiUsageSummary {
  last24h: number;
  last30d: number;
  errors24h: number;
  liveKeys: number;
}

export async function apiUsageSummary(): Promise<ApiUsageSummary> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const month = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [dayCount, monthCount, errorCount, keys] = await Promise.all([
    sb
      .from('api_request_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', day),
    sb
      .from('api_request_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', month),
    sb
      .from('api_request_logs')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', day)
      .gte('status', 400),
    sb
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('revoked_at', null),
  ]);

  return {
    last24h: dayCount.count ?? 0,
    last30d: monthCount.count ?? 0,
    errors24h: errorCount.count ?? 0,
    liveKeys: keys.count ?? 0,
  };
}

export interface WebhookEventCatalogueRow extends WebhookEventType {
  /** An active endpoint of this company is subscribed to the event. */
  subscribed: boolean;
}

/** The public event catalogue, annotated with what this company subscribes to. */
export async function webhookEventCatalogue(): Promise<WebhookEventCatalogueRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const [types, endpoints] = await Promise.all([
    listWebhookEventTypes(),
    sb.from('webhook_endpoints').select('events').eq('company_id', companyId).eq('active', true),
  ]);

  const subscribed = new Set<string>();
  for (const row of endpoints.data ?? []) {
    for (const event of ((row as { events?: string[] }).events ?? [])) subscribed.add(event);
  }
  return types.map((type) => ({ ...type, subscribed: subscribed.has(type.event) }));
}
