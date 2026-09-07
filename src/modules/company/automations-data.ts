import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { env } from '@/lib/env';
import type { AutomationEvent } from '@/lib/commerce/automation-templates';
import { getCompanyId } from './data';

/** Read models for the /company/automations screen. Company-scoped throughout. */

export interface AutomationRuleRow {
  id: string;
  name: string;
  triggerEvent: AutomationEvent;
  channel: string;
  templateName: string | null;
  messageTemplate: string;
  delayMinutes: number;
  conditions: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  lastRunAt: string | null;
}

export interface AutomationRunRow {
  id: number;
  ruleId: string;
  ruleName: string;
  entityType: string;
  entityId: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  error: string | null;
}

export interface StoreWebhookRow {
  id: string;
  provider: string;
  name: string;
  status: string;
  token: string | null;
  url: string | null;
  /**
   * The signing secret for THIS shop, in plain text, because the person reading
   * the page has to paste it into their own store's webhook settings. It is
   * theirs, it is stored encrypted, and it is shown only to a company admin.
   */
  secret: string | null;
}

export async function listAutomationRules(): Promise<AutomationRuleRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: rules } = await sb
    .from('automation_rules')
    .select(
      'id,name,trigger_event,channel,template_name,message_template,delay_minutes,conditions_json,is_active,created_at',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (rules ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // One pass over recent runs beats a count query per rule.
  const { data: runs } = await sb
    .from('automation_runs')
    .select('rule_id,status,sent_at,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(2000);

  const stats = new Map<string, { sent: number; failed: number; pending: number; last: string | null }>();
  for (const r of (runs ?? []) as Array<Record<string, unknown>>) {
    const key = r.rule_id as string;
    const entry = stats.get(key) ?? { sent: 0, failed: 0, pending: 0, last: null };
    const status = r.status as string;
    if (status === 'sent') entry.sent += 1;
    else if (status === 'failed') entry.failed += 1;
    else if (status === 'pending') entry.pending += 1;
    const when = (r.sent_at as string | null) ?? (r.created_at as string | null);
    if (when && (!entry.last || when > entry.last)) entry.last = when;
    stats.set(key, entry);
  }

  return rows.map((x) => {
    const stat = stats.get(x.id as string);
    return {
      id: x.id as string,
      name: (x.name as string) || 'Untitled automation',
      triggerEvent: x.trigger_event as AutomationEvent,
      channel: x.channel as string,
      templateName: (x.template_name as string) ?? null,
      messageTemplate: (x.message_template as string) ?? '',
      delayMinutes: Number(x.delay_minutes ?? 0),
      conditions: (x.conditions_json as Record<string, unknown>) ?? {},
      isActive: x.is_active !== false,
      createdAt: x.created_at as string,
      sentCount: stat?.sent ?? 0,
      failedCount: stat?.failed ?? 0,
      pendingCount: stat?.pending ?? 0,
      lastRunAt: stat?.last ?? null,
    };
  });
}

export async function listAutomationRuns(limit = 25): Promise<AutomationRunRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('automation_runs')
    .select('id,rule_id,entity_type,entity_id,status,scheduled_for,sent_at,error,automation_rules(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return ((data ?? []) as Array<Record<string, unknown>>).map((x) => ({
    id: Number(x.id),
    ruleId: x.rule_id as string,
    ruleName: ((x.automation_rules as { name?: string } | null)?.name ?? '').trim() || 'Deleted rule',
    entityType: x.entity_type as string,
    entityId: x.entity_id as string,
    status: x.status as string,
    scheduledFor: x.scheduled_for as string,
    sentAt: (x.sent_at as string) ?? null,
    error: (x.error as string) ?? null,
  }));
}

/** The store webhook URLs to paste into Shopify / WooCommerce. */
export async function listStoreWebhooks(): Promise<StoreWebhookRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('integration_accounts')
    .select('id,provider,name,status,webhook_token,webhook_secret_encrypted')
    .eq('company_id', companyId)
    .in('provider', ['shopify', 'woocommerce'])
    .order('created_at', { ascending: false })
    .limit(20);

  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  return ((data ?? []) as Array<Record<string, unknown>>).map((x) => {
    const token = (x.webhook_token as string) ?? null;
    let secret: string | null = null;
    const enc = x.webhook_secret_encrypted as string | null;
    if (enc) {
      // An account whose secret will not decrypt still has a usable URL, so the
      // row is worth showing — it just cannot display the secret.
      try {
        secret = decryptSecret(enc) || null;
      } catch {
        secret = null;
      }
    }
    return {
      id: x.id as string,
      provider: x.provider as string,
      name: (x.name as string) || (x.provider as string),
      status: x.status as string,
      token,
      url: token ? `${base}/api/webhooks/store/${x.provider as string}?t=${token}` : null,
      secret,
    };
  });
}
