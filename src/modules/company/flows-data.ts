import { createSupabaseServiceClient } from '@/lib/db/server';
import { parseGraph, type FlowGraph } from '@/lib/flows/types';
import { getCompanyId } from './data';

/**
 * Read side of the flow builder.
 *
 * TENANT ISOLATION: every query below is filtered by the SESSION user's
 * `company_id` — never by an id taken from the request — and the per-flow
 * readers filter by `company_id` *and* `id` so a guessed flow uuid from another
 * tenant returns null rather than someone else's graph.
 */

export type FlowStatus = 'draft' | 'live' | 'paused';
export type TriggerType = 'keyword' | 'referral' | 'ad' | 'comment' | 'intent' | 'welcome' | 'event';
export type MatchMode = 'exact' | 'contains' | 'starts_with' | 'regex';
export type NluProvider = 'builtin' | 'wit' | 'intnt';

export interface FlowTriggerRow {
  id: string;
  flowId: string;
  type: TriggerType;
  matchValue: string;
  matchMode: MatchMode;
  channels: string[];
  isActive: boolean;
  createdAt: string;
}

export interface FlowListRow {
  id: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  channels: string[];
  priority: number;
  version: number;
  updatedAt: string;
  blockCount: number;
  triggers: FlowTriggerRow[];
}

export interface FlowVersionRow {
  version: number;
  createdAt: string;
}

export interface FlowDetail {
  id: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  channels: string[];
  priority: number;
  version: number;
  botId: string | null;
  updatedAt: string;
  graph: FlowGraph;
  triggers: FlowTriggerRow[];
  versions: FlowVersionRow[];
}

const asRec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

function mapTrigger(row: Record<string, unknown>): FlowTriggerRow {
  return {
    id: row.id as string,
    flowId: row.flow_id as string,
    type: (row.type as TriggerType) ?? 'keyword',
    matchValue: (row.match_value as string) ?? '',
    matchMode: (row.match_mode as MatchMode) ?? 'contains',
    channels: (row.channels as string[]) ?? [],
    isActive: row.is_active !== false,
    createdAt: row.created_at as string,
  };
}

export async function listFlows(): Promise<FlowListRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data: flows } = await sb
    .from('flows')
    .select('id,name,description,status,graph_json,channels,priority,version,updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(200);

  const rows = (flows ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // One extra round trip for every trigger in the company, grouped in memory —
  // cheaper than N queries and the row count is tiny (a few per flow).
  const { data: triggers } = await sb
    .from('flow_triggers')
    .select('id,flow_id,type,match_value,match_mode,channels,is_active,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });

  const byFlow = new Map<string, FlowTriggerRow[]>();
  for (const raw of (triggers ?? []) as Record<string, unknown>[]) {
    const t = mapTrigger(raw);
    const list = byFlow.get(t.flowId);
    if (list) list.push(t);
    else byFlow.set(t.flowId, [t]);
  }

  return rows.map((r) => {
    const graph = parseGraph(r.graph_json);
    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string) ?? null,
      status: (r.status as FlowStatus) ?? 'draft',
      channels: (r.channels as string[]) ?? [],
      priority: (r.priority as number) ?? 0,
      version: (r.version as number) ?? 1,
      updatedAt: r.updated_at as string,
      blockCount: graph.nodes.length,
      triggers: byFlow.get(r.id as string) ?? [],
    };
  });
}

export async function getFlow(id: string): Promise<FlowDetail | null> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  const { data } = await sb
    .from('flows')
    .select('id,name,description,status,graph_json,channels,priority,version,bot_id,updated_at')
    .eq('company_id', companyId) // scope prevents cross-company access
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = asRec(data);

  const [{ data: triggers }, { data: versions }] = await Promise.all([
    sb
      .from('flow_triggers')
      .select('id,flow_id,type,match_value,match_mode,channels,is_active,created_at')
      .eq('company_id', companyId)
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
    sb
      .from('flow_versions')
      .select('version,created_at')
      .eq('company_id', companyId)
      .eq('flow_id', id)
      .order('version', { ascending: false })
      .limit(25),
  ]);

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    status: (row.status as FlowStatus) ?? 'draft',
    channels: (row.channels as string[]) ?? [],
    priority: (row.priority as number) ?? 0,
    version: (row.version as number) ?? 1,
    botId: (row.bot_id as string) ?? null,
    updatedAt: row.updated_at as string,
    graph: parseGraph(row.graph_json),
    triggers: ((triggers ?? []) as Record<string, unknown>[]).map(mapTrigger),
    versions: ((versions ?? []) as Record<string, unknown>[]).map((v) => ({
      version: v.version as number,
      createdAt: v.created_at as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export interface FlowNodeStat {
  nodeId: string;
  nodeType: string | null;
  entered: number;
  answered: number;
  completed: number;
  errors: number;
  /** Of the people who reached this block, how many never reached the next one. */
  dropOff: number;
}

export interface FlowAnalytics {
  starts: number;
  completions: number;
  inProgress: number;
  cancelled: number;
  /** starts - completions, floored at zero. */
  dropOff: number;
  completionRate: number;
  nodes: FlowNodeStat[];
}

const EMPTY_ANALYTICS: FlowAnalytics = {
  starts: 0,
  completions: 0,
  inProgress: 0,
  cancelled: 0,
  dropOff: 0,
  completionRate: 0,
  nodes: [],
};

/**
 * Per-node funnel for one flow.
 *
 * Aggregated in memory rather than with a SQL `group by` because PostgREST has
 * no grouping verb — the event table is capped by the `limit` below, which is
 * plenty for the "where do people fall out?" question the builder asks.
 */
export async function listFlowAnalytics(flowId: string): Promise<FlowAnalytics> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();

  // Confirm the flow is ours before reading anything keyed by its id.
  const { data: owned } = await sb
    .from('flows')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', flowId)
    .maybeSingle();
  if (!owned) return EMPTY_ANALYTICS;

  const [{ data: sessions }, { data: events }] = await Promise.all([
    sb
      .from('flow_sessions')
      .select('status')
      .eq('company_id', companyId)
      .eq('flow_id', flowId)
      .limit(10000),
    sb
      .from('flow_node_events')
      .select('node_id,node_type,event')
      .eq('company_id', companyId)
      .eq('flow_id', flowId)
      .order('created_at', { ascending: false })
      .limit(20000),
  ]);

  let starts = 0;
  let completions = 0;
  let inProgress = 0;
  let cancelled = 0;
  for (const raw of (sessions ?? []) as Record<string, unknown>[]) {
    starts += 1;
    const status = raw.status as string;
    if (status === 'completed') completions += 1;
    else if (status === 'cancelled') cancelled += 1;
    else inProgress += 1;
  }

  const stats = new Map<string, FlowNodeStat>();
  for (const raw of (events ?? []) as Record<string, unknown>[]) {
    const nodeId = raw.node_id as string;
    if (!nodeId) continue;
    let stat = stats.get(nodeId);
    if (!stat) {
      stat = {
        nodeId,
        nodeType: (raw.node_type as string) ?? null,
        entered: 0,
        answered: 0,
        completed: 0,
        errors: 0,
        dropOff: 0,
      };
      stats.set(nodeId, stat);
    }
    switch (raw.event as string) {
      case 'entered':
        stat.entered += 1;
        break;
      case 'answered':
        stat.answered += 1;
        break;
      case 'completed':
        stat.completed += 1;
        break;
      case 'error':
        stat.errors += 1;
        break;
      case 'abandoned':
        stat.dropOff += 1;
        break;
      default:
        break;
    }
  }

  // A question block people entered but never answered is the drop-off signal
  // the builder highlights; non-question blocks have no answer event at all, so
  // only count the gap where an answer was possible.
  for (const stat of stats.values()) {
    if (stat.answered > 0 && stat.entered > stat.answered) {
      stat.dropOff = Math.max(stat.dropOff, stat.entered - stat.answered);
    }
  }

  return {
    starts,
    completions,
    inProgress,
    cancelled,
    dropOff: Math.max(0, starts - completions),
    completionRate: starts > 0 ? Math.round((completions / starts) * 100) : 0,
    nodes: [...stats.values()].sort((a, b) => b.entered - a.entered),
  };
}

// ---------------------------------------------------------------------------
// Intents / NLU
// ---------------------------------------------------------------------------
export interface IntentRow {
  id: string;
  name: string;
  description: string | null;
  examples: string[];
  provider: NluProvider;
  isActive: boolean;
  createdAt: string;
}

export async function listIntents(): Promise<IntentRow[]> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bot_intents')
    .select('id,name,description,examples,provider,is_active,created_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(300);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    examples: (r.examples as string[]) ?? [],
    provider: (r.provider as NluProvider) ?? 'builtin',
    isActive: r.is_active !== false,
    createdAt: r.created_at as string,
  }));
}

export interface NluSettings {
  provider: NluProvider;
  /** The token itself never leaves the server — the UI only needs to know one exists. */
  hasToken: boolean;
  /** Provider-specific extras, e.g. wit.ai API version. */
  settings: Record<string, unknown>;
  updatedAt: string | null;
}

export async function getNluSettings(): Promise<NluSettings> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('nlu_settings')
    .select('provider,token_encrypted,settings_json,updated_at')
    .eq('company_id', companyId)
    .maybeSingle();
  const row = asRec(data);
  return {
    provider: (row.provider as NluProvider) ?? 'builtin',
    hasToken: Boolean(row.token_encrypted),
    settings: (row.settings_json as Record<string, unknown>) ?? {},
    updatedAt: (row.updated_at as string) ?? null,
  };
}

/** Flow names for the "Go to flow" block's target picker. */
export async function listFlowOptions(): Promise<Array<{ id: string; name: string }>> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('flows')
    .select('id,name')
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(200);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));
}
