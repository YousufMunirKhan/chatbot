import type { OutboundBlock } from '@/lib/channels/types';

/**
 * The block palette. Grouped the way the builder's sidebar groups them:
 * content, questions, logic, actions, advanced.
 */
export const FLOW_NODE_TYPES = [
  // content
  'start',
  'message',
  'image',
  'video',
  'file',
  'gallery',
  // questions
  'ask',
  'buttons',
  'quick_replies',
  'csat',
  // logic
  'condition',
  'random',
  'delay',
  'jump',
  'end',
  // actions
  'tag',
  'assign',
  'handoff',
  'save_lead',
  'http',
  'ai',
  'subscribe',
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

/** Nodes that stop the run and wait for the customer's next message. */
export const WAITING_NODE_TYPES: FlowNodeType[] = ['ask', 'buttons', 'quick_replies', 'csat'];

export type AskValidation = 'text' | 'email' | 'phone' | 'number' | 'date' | 'url';

export interface FlowChoice {
  /** Stable id used as the edge's sourceHandle. */
  id: string;
  label: string;
  /** Payload echoed back by the channel; defaults to the label. */
  value?: string;
  url?: string;
}

export interface FlowNodeData {
  label?: string;
  /** message / ask / buttons / quick_replies / csat */
  text?: string;
  /** image / video / file */
  url?: string;
  caption?: string;
  fileName?: string;
  /** gallery */
  items?: Array<{ title: string; subtitle?: string; imageUrl?: string; buttons?: FlowChoice[] }>;
  /** buttons / quick_replies */
  choices?: FlowChoice[];
  /** ask */
  variable?: string;
  validation?: AskValidation;
  retryText?: string;
  maxRetries?: number;
  /** condition */
  conditions?: Array<{ variable: string; operator: ConditionOperator; value?: string }>;
  /** condition — how multiple clauses combine. */
  match?: 'all' | 'any';
  /** delay (seconds, capped by the runtime) */
  seconds?: number;
  /** tag */
  tags?: string[];
  /** assign */
  agentId?: string;
  /** jump */
  targetFlowId?: string;
  /** http */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** http — map response JSON paths into flow variables. */
  responseMap?: Record<string, string>;
  /** ai — an optional instruction layered on the assistant's own prompt. */
  instruction?: string;
  /** subscribe — opt the contact in or out of broadcasts. */
  optIn?: boolean;
  /** save_lead */
  leadFields?: Record<string, string>;
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'is_set'
  | 'is_empty'
  | 'greater_than'
  | 'less_than';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  /** Which output of the source node: a choice id, 'true'/'false', or 'default'. */
  sourceHandle?: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowRecord {
  id: string;
  companyId: string;
  botId: string | null;
  name: string;
  status: 'draft' | 'live' | 'paused';
  graph: FlowGraph;
  channels: string[];
  priority: number;
}

/** Variables collected so far, plus the built-ins the runtime always provides. */
export type FlowState = Record<string, string | number | boolean | null>;

export interface FlowRunOutput {
  blocks: OutboundBlock[];
  /** Node the flow is now parked on, or null when the run finished. */
  awaitingNodeId: string | null;
  state: FlowState;
  completed: boolean;
  /** Set when a node asked for the AI to answer this turn. */
  handoffToAi: boolean;
  aiInstruction?: string;
  /** Set when a node escalated to a human. */
  handoffToHuman: boolean;
}

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

/** Defensive parse — a hand-edited or partially saved graph must not throw. */
export function parseGraph(value: unknown): FlowGraph {
  if (!value || typeof value !== 'object') return EMPTY_GRAPH;
  const raw = value as { nodes?: unknown; edges?: unknown };
  const nodes = Array.isArray(raw.nodes)
    ? (raw.nodes.filter(
        (n) => n && typeof n === 'object' && typeof (n as FlowNode).id === 'string',
      ) as FlowNode[])
    : [];
  const edges = Array.isArray(raw.edges)
    ? (raw.edges.filter(
        (e) =>
          e &&
          typeof e === 'object' &&
          typeof (e as FlowEdge).source === 'string' &&
          typeof (e as FlowEdge).target === 'string',
      ) as FlowEdge[])
    : [];
  return { nodes, edges };
}
