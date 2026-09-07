import { createSupabaseServiceClient } from '@/lib/db/server';
import { logger } from '@/lib/logger';
import { classifyIntent, loadIntents } from './nlu';
import { parseGraph } from './types';
import type { FlowRecord } from './types';

export type TriggerType = 'keyword' | 'referral' | 'ad' | 'comment' | 'intent' | 'welcome' | 'event';
export type MatchMode = 'exact' | 'contains' | 'starts_with' | 'regex';

export interface TriggerRecord {
  id: string;
  flowId: string;
  type: TriggerType;
  matchValue: string;
  matchMode: MatchMode;
  channels: string[];
  flow: FlowRecord;
}

/**
 * Trigger lookups run on every inbound message, so the live trigger set is
 * cached per company for a few seconds. The window is short enough that an
 * editor sees their change almost immediately and long enough that a busy
 * account is not re-reading the same rows on every keystroke of a conversation.
 */
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; triggers: TriggerRecord[] }>();

export function invalidateTriggerCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

export async function loadLiveTriggers(companyId: string): Promise<TriggerRecord[]> {
  const cached = cache.get(companyId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.triggers;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('flow_triggers')
    .select(
      'id,flow_id,type,match_value,match_mode,channels,is_active,' +
        'flows!inner(id,company_id,bot_id,name,status,graph_json,channels,priority)',
    )
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('flows.status', 'live')
    .limit(500);

  if (error) {
    logger.warn('Failed to load flow triggers', { companyId, error: error.message });
    return [];
  }

  const triggers: TriggerRecord[] = [];
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const flowRow = row.flows as Record<string, unknown> | null;
    if (!flowRow) continue;
    // TENANT ISOLATION: never run a flow belonging to another company, even if a
    // trigger row were ever mis-keyed.
    if (flowRow.company_id !== companyId) continue;
    triggers.push({
      id: row.id as string,
      flowId: row.flow_id as string,
      type: row.type as TriggerType,
      matchValue: (row.match_value as string) ?? '',
      matchMode: ((row.match_mode as string) ?? 'contains') as MatchMode,
      channels: (row.channels as string[]) ?? [],
      flow: {
        id: flowRow.id as string,
        companyId: flowRow.company_id as string,
        botId: (flowRow.bot_id as string) ?? null,
        name: flowRow.name as string,
        status: flowRow.status as FlowRecord['status'],
        graph: parseGraph(flowRow.graph_json),
        channels: (flowRow.channels as string[]) ?? [],
        priority: (flowRow.priority as number) ?? 0,
      },
    });
  }

  cache.set(companyId, { at: Date.now(), triggers });
  return triggers;
}

/** Does a text value satisfy one trigger's match rule? */
export function textMatches(value: string, matchValue: string, mode: MatchMode): boolean {
  const haystack = value.trim().toLowerCase();
  const needle = matchValue.trim().toLowerCase();
  if (!needle) return false;
  switch (mode) {
    case 'exact':
      return haystack === needle;
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'regex':
      try {
        // A user-authored pattern must never take down the webhook.
        return new RegExp(matchValue, 'i').test(value);
      } catch {
        return false;
      }
    case 'contains':
    default:
      // Whole-word containment, so "hi" does not fire on "this".
      return new RegExp(`(^|\\P{L})${escapeRegExp(needle)}($|\\P{L})`, 'iu').test(haystack);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function channelAllowed(trigger: TriggerRecord, channel: string): boolean {
  const flowChannels = trigger.flow.channels;
  if (flowChannels.length > 0 && !flowChannels.includes(channel)) return false;
  if (trigger.channels.length > 0 && !trigger.channels.includes(channel)) return false;
  return true;
}

/** Specificity order used when two triggers both match the same message. */
const TYPE_RANK: Record<TriggerType, number> = {
  ad: 6,
  referral: 5,
  comment: 4,
  keyword: 3,
  intent: 2,
  event: 1,
  welcome: 0,
};

export interface TriggerContext {
  companyId: string;
  botId: string | null;
  channel: string;
  text: string;
  referral?: string | null;
  /** True when this is the first customer message of a new conversation. */
  isFirstMessage?: boolean;
  kind?: 'message' | 'comment';
  /** Custom event name, when a flow is started by an API/automation event. */
  eventName?: string | null;
}

export interface TriggerHit {
  trigger: TriggerRecord;
  flow: FlowRecord;
  /** What matched, for the analytics trail. */
  reason: string;
}

/**
 * Pick the flow that should handle this message, or null to let the AI answer.
 *
 * Cheap checks run first and the (still local, but heavier) intent classifier
 * only runs when an intent trigger actually exists and nothing more specific has
 * already matched.
 */
export async function matchTrigger(ctx: TriggerContext): Promise<TriggerHit | null> {
  const triggers = (await loadLiveTriggers(ctx.companyId)).filter(
    (t) => channelAllowed(t, ctx.channel) && (!t.flow.botId || !ctx.botId || t.flow.botId === ctx.botId),
  );
  if (triggers.length === 0) return null;

  const hits: TriggerHit[] = [];

  for (const trigger of triggers) {
    switch (trigger.type) {
      case 'welcome':
        if (ctx.isFirstMessage) hits.push({ trigger, flow: trigger.flow, reason: 'first message' });
        break;
      case 'comment':
        if (ctx.kind === 'comment' && (!trigger.matchValue || textMatches(ctx.text, trigger.matchValue, trigger.matchMode))) {
          hits.push({ trigger, flow: trigger.flow, reason: 'post comment' });
        }
        break;
      case 'referral':
      case 'ad':
        if (ctx.referral && textMatches(ctx.referral, trigger.matchValue, trigger.matchMode)) {
          hits.push({ trigger, flow: trigger.flow, reason: `${trigger.type}: ${trigger.matchValue}` });
        }
        break;
      case 'keyword':
        if (ctx.text && textMatches(ctx.text, trigger.matchValue, trigger.matchMode)) {
          hits.push({ trigger, flow: trigger.flow, reason: `keyword: ${trigger.matchValue}` });
        }
        break;
      case 'event':
        if (ctx.eventName && ctx.eventName === trigger.matchValue) {
          hits.push({ trigger, flow: trigger.flow, reason: `event: ${trigger.matchValue}` });
        }
        break;
      case 'intent':
        break; // handled below, only if needed
    }
  }

  if (hits.length > 0) return pickBest(hits);

  const intentTriggers = triggers.filter((t) => t.type === 'intent');
  if (intentTriggers.length === 0 || !ctx.text.trim()) return null;

  const intents = await loadIntents(ctx.companyId, ctx.botId);
  if (intents.length === 0) return null;
  const match = await classifyIntent({
    companyId: ctx.companyId,
    botId: ctx.botId,
    text: ctx.text,
    intents,
  });
  if (!match) return null;

  const intentHits = intentTriggers
    .filter((t) => t.matchValue.trim().toLowerCase() === match.name.trim().toLowerCase())
    .map((trigger) => ({ trigger, flow: trigger.flow, reason: `intent: ${match.name}` }));
  return intentHits.length ? pickBest(intentHits) : null;
}

function pickBest(hits: TriggerHit[]): TriggerHit {
  return hits.sort((a, b) => {
    if (b.flow.priority !== a.flow.priority) return b.flow.priority - a.flow.priority;
    if (TYPE_RANK[b.trigger.type] !== TYPE_RANK[a.trigger.type]) {
      return TYPE_RANK[b.trigger.type] - TYPE_RANK[a.trigger.type];
    }
    // Longer keyword wins: "order status" beats "order".
    return b.trigger.matchValue.length - a.trigger.matchValue.length;
  })[0] as TriggerHit;
}

/** Load one live flow directly — used by `jump` nodes and API-started flows. */
export async function loadFlowById(companyId: string, flowId: string): Promise<FlowRecord | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flows')
    .select('id,company_id,bot_id,name,status,graph_json,channels,priority')
    .eq('company_id', companyId)
    .eq('id', flowId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    botId: (row.bot_id as string) ?? null,
    name: row.name as string,
    status: row.status as FlowRecord['status'],
    graph: parseGraph(row.graph_json),
    channels: (row.channels as string[]) ?? [],
    priority: (row.priority as number) ?? 0,
  };
}
