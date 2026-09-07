import { createSupabaseServiceClient } from '@/lib/db/server';
import { isOptedIn } from '@/lib/channels/subscriptions';
import { decryptSecret } from '@/lib/crypto';
import { getChannelAdapter } from '@/lib/channels/registry';
import { textBlocks, type ChannelKey, type ChannelSendContext } from '@/lib/channels/types';
import { logger } from '@/lib/logger';
import { getWhatsAppServiceWindow } from '@/lib/channels/whatsapp';
import { serviceWindowRefusalReason } from '@/lib/channels/whatsapp-window';
import {
  contactForChannel,
  evaluateConditions,
  renderTemplate,
  type AutomationEntity,
  type AutomationEvent,
} from './automation-templates';

/**
 * E-commerce automation engine.
 *
 * `queueAutomations` is called from wherever a commerce event is observed (a
 * store webhook, the abandoned-cart detector). It never sends anything: it only
 * writes `automation_runs` rows, so a burst of webhook retries costs database
 * inserts that collide on the unique index rather than duplicate messages.
 *
 * `dispatchDueAutomations` is called from the cron route. It claims each due
 * row (by stamping `sent_at` under an `is null` guard, so two overlapping cron
 * runs cannot both take the same row), renders the template, checks the
 * contact is reachable and not opted out, and sends via the channel adapter.
 */

export interface QueueResult {
  matched: number;
  queued: number;
  skipped: number;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface RuleRow {
  id: string;
  company_id: string;
  channel: string;
  message_template: string;
  template_name: string | null;
  delay_minutes: number;
  conditions_json: unknown;
}

/** Every automation query is company-scoped — this is the tenant boundary. */
export async function listActiveRules(companyId: string, event: AutomationEvent): Promise<RuleRow[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('automation_rules')
    .select('id,company_id,channel,message_template,template_name,delay_minutes,conditions_json')
    .eq('company_id', companyId)
    .eq('trigger_event', event)
    .eq('is_active', true)
    .limit(50);
  return (data ?? []) as unknown as RuleRow[];
}

/**
 * Find the active rules for `event`, evaluate their conditions against the
 * entity, and schedule one run each. Returning counts (rather than throwing)
 * keeps a webhook 200 even when one rule is misconfigured.
 */
export async function queueAutomations(
  companyId: string,
  event: AutomationEvent,
  entity: AutomationEntity,
): Promise<QueueResult> {
  const result: QueueResult = { matched: 0, queued: 0, skipped: 0 };
  if (!companyId || !entity?.id) return result;

  const rules = await listActiveRules(companyId, event);
  if (rules.length === 0) return result;

  const sb = createSupabaseServiceClient();
  const now = Date.now();

  for (const rule of rules) {
    if (!evaluateConditions(rule.conditions_json, entity)) {
      result.skipped += 1;
      continue;
    }
    result.matched += 1;
    const scheduledFor = new Date(now + Math.max(0, Number(rule.delay_minutes) || 0) * 60_000).toISOString();
    const { error } = await sb.from('automation_runs').insert({
      company_id: companyId,
      rule_id: rule.id,
      entity_type: entity.type,
      entity_id: entity.id,
      status: 'pending',
      scheduled_for: scheduledFor,
      payload_json: entity as unknown as Record<string, unknown>,
    });
    if (!error) {
      result.queued += 1;
      continue;
    }
    // 23505 = unique_violation → this rule already ran (or is queued) for this
    // entity. That is the whole point of the index, not an error worth logging.
    if ((error as { code?: string }).code === '23505') {
      result.skipped += 1;
      continue;
    }
    result.skipped += 1;
    logger.warn('Automation queue insert failed', { companyId, error: error.message });
  }
  return result;
}

/**
 * Has this contact asked us to stop?
 *
 * Delegates to the shared consent helper rather than querying the table by
 * hand. An earlier version guessed the column names (`contact`, `opted_out`)
 * before `contact_subscriptions` existed; the query errored, the catch swallowed
 * it, and every automation reported "not opted out" — so order and cart
 * messages went to people who had replied STOP.
 *
 * The table may still be absent in a deployment that has not run migration
 * 0054, so a thrown error means "no opt-out on record" rather than blocking
 * every send. A *successful* query that says opted-out always blocks.
 */
async function isOptedOut(companyId: string, channel: string, contact: string): Promise<boolean> {
  try {
    return !(await isOptedIn(companyId, channel, contact));
  } catch {
    return false;
  }
}

/** Load and decrypt the company's connected identity for a channel. */
async function loadSendContext(companyId: string, channel: string): Promise<ChannelSendContext | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('channel_identities')
    .select('external_id,secret_encrypted,settings_json')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { external_id: string; secret_encrypted: string | null; settings_json: unknown };

  let secret: string | null = null;
  if (row.secret_encrypted) {
    try {
      secret = decryptSecret(row.secret_encrypted);
    } catch {
      secret = row.secret_encrypted; // tolerate a plaintext token in dev/test
    }
  }
  return {
    companyId,
    channel: channel as ChannelKey,
    externalId: row.external_id,
    secret,
    settings: (row.settings_json as Record<string, unknown>) ?? {},
  };
}

interface DueRun {
  id: number;
  company_id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  automation_rules: {
    channel: string;
    message_template: string;
    template_name: string | null;
    is_active: boolean;
  } | null;
}

async function finish(
  id: number,
  patch: { status: 'sent' | 'failed' | 'skipped'; error?: string | null },
): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb
    .from('automation_runs')
    .update({
      status: patch.status,
      error: patch.error ?? null,
      // `sent_at` doubles as the claim marker, so it is stamped before we know
      // the outcome. Only a real send keeps it — the status column is what
      // stops a finished row being claimed again.
      sent_at: patch.status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', id);
}

/**
 * Send every run whose delay has elapsed. Safe to call concurrently: the claim
 * update only succeeds for the caller that finds `sent_at` still null.
 */
export async function dispatchDueAutomations(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const sb = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data } = await sb
    .from('automation_runs')
    .select(
      'id,company_id,rule_id,entity_type,entity_id,payload_json,automation_rules(channel,message_template,template_name,is_active)',
    )
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(Math.max(1, Math.min(500, limit)));

  const runs = (data ?? []) as unknown as DueRun[];
  // Contexts are per (company, channel) — load each at most once per cron run.
  const contexts = new Map<string, ChannelSendContext | null>();

  for (const run of runs) {
    // Claim: only one process can flip sent_at from null.
    const { data: claimed } = await sb
      .from('automation_runs')
      .update({ sent_at: new Date().toISOString() })
      .eq('id', run.id)
      .eq('status', 'pending')
      .is('sent_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) continue;
    result.claimed += 1;

    const rule = run.automation_rules;
    if (!rule || rule.is_active === false) {
      await finish(run.id, { status: 'skipped', error: 'Rule removed or paused' });
      result.skipped += 1;
      continue;
    }

    try {
      const entity = (run.payload_json ?? {}) as AutomationEntity;
      const to = contactForChannel(rule.channel, entity);
      if (!to) {
        await finish(run.id, { status: 'skipped', error: `No ${rule.channel} contact for this customer` });
        result.skipped += 1;
        continue;
      }
      if (await isOptedOut(run.company_id, rule.channel, to)) {
        await finish(run.id, { status: 'skipped', error: 'Contact opted out' });
        result.skipped += 1;
        continue;
      }

      const message = renderTemplate(rule.message_template, entity);
      if (!message) {
        await finish(run.id, { status: 'skipped', error: 'Template rendered empty' });
        result.skipped += 1;
        continue;
      }

      const key = `${run.company_id}:${rule.channel}`;
      if (!contexts.has(key)) contexts.set(key, await loadSendContext(run.company_id, rule.channel));
      const ctx = contexts.get(key) ?? null;
      if (!ctx) {
        await finish(run.id, { status: 'failed', error: `No active ${rule.channel} channel connected` });
        result.failed += 1;
        continue;
      }

      const adapter = getChannelAdapter(rule.channel);
      if (!adapter) {
        await finish(run.id, { status: 'failed', error: `Unsupported channel ${rule.channel}` });
        result.failed += 1;
        continue;
      }

      // The email adapter takes its subject line from the send settings, so the
      // rule's template name doubles as the subject (placeholders and all).
      const sendCtx: ChannelSendContext =
        rule.channel === 'email'
          ? {
              ...ctx,
              settings: {
                ...ctx.settings,
                subject: renderTemplate(rule.template_name ?? '', entity) || 'An update on your order',
              },
            }
          : ctx;

      // An order update or abandoned-cart nudge is sent by the business, days
      // after the customer last wrote — which is precisely the case Meta
      // refuses. The reply path needs no such check (the customer has just
      // messaged, so the window is open by definition); this one does.
      if (rule.channel === 'whatsapp') {
        const refusal = serviceWindowRefusalReason(
          await getWhatsAppServiceWindow(ctx.companyId, to),
        );
        if (refusal) {
          await finish(run.id, { status: 'failed', error: refusal });
          result.failed += 1;
          continue;
        }
      }

      const ok = await adapter.send(sendCtx, to, textBlocks(message));
      if (ok) {
        await finish(run.id, { status: 'sent', error: null });
        result.sent += 1;
      } else {
        await finish(run.id, { status: 'failed', error: 'Channel refused the message' });
        result.failed += 1;
      }
    } catch (err) {
      await finish(run.id, {
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'dispatch failed',
      });
      result.failed += 1;
    }
  }

  return result;
}
