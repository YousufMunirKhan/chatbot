import type { OutboundBlock, OutboundButton } from '@/lib/channels/types';
import type {
  ConditionOperator,
  FlowChoice,
  FlowGraph,
  FlowNode,
  FlowNodeData,
  FlowState,
} from './types';
import { WAITING_NODE_TYPES } from './types';

/** Side effects the pure engine records for the persistence layer to apply. */
export type FlowEffect =
  | { type: 'tag'; tags: string[] }
  | { type: 'assign'; agentId?: string }
  | { type: 'handoff' }
  | { type: 'save_lead'; fields: Record<string, string> }
  | { type: 'subscribe'; optIn: boolean }
  | { type: 'csat' }
  | { type: 'jump'; flowId: string }
  | { type: 'node'; nodeId: string; nodeType: string; event: 'entered' | 'answered' | 'error' };

export interface EngineResult {
  blocks: OutboundBlock[];
  state: FlowState;
  awaitingNodeId: string | null;
  completed: boolean;
  handoffToAi: boolean;
  aiInstruction?: string;
  handoffToHuman: boolean;
  effects: FlowEffect[];
  /** Set when a `jump` node pointed at another flow. */
  jumpFlowId?: string;
}

export interface EngineDeps {
  /** Injected so the HTTP block is testable without a network. */
  httpFetch?: typeof fetch;
  /** Guard against a graph that loops forever. */
  maxSteps?: number;
  /** Longest a `delay` block may block the turn; longer waits just continue. */
  maxInlineDelayMs?: number;
}

const DEFAULT_MAX_STEPS = 60;
const DEFAULT_MAX_INLINE_DELAY_MS = 3000;

/** Replace {{variable}} references, leaving unknown names blank. */
export function interpolate(text: string | undefined, state: FlowState): string {
  if (!text) return '';
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = state[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function choicesOf(data: FlowNodeData): FlowChoice[] {
  return (data.choices ?? []).filter((c) => c && typeof c.label === 'string' && c.label.trim() !== '');
}

function toButtons(choices: FlowChoice[], state: FlowState): OutboundButton[] {
  return choices.map((c) => ({
    label: interpolate(c.label, state).slice(0, 60),
    value: c.value ?? c.id,
    url: c.url ? interpolate(c.url, state) : undefined,
  }));
}

function findNode(graph: FlowGraph, id: string | null | undefined): FlowNode | null {
  if (!id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

/** Follow one output of a node. `handle` defaults to the unlabelled output. */
function nextNodeId(graph: FlowGraph, nodeId: string, handle = 'default'): string | null {
  const exact = graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === handle);
  if (exact) return exact.target;
  if (handle !== 'default') return null;
  // Tolerate graphs saved by an editor that omitted the handle entirely.
  const loose = graph.edges.find((e) => e.source === nodeId);
  return loose ? loose.target : null;
}

export function findStartNode(graph: FlowGraph): FlowNode | null {
  const explicit = graph.nodes.find((n) => n.type === 'start');
  if (explicit) return explicit;
  // No start block: the first node nothing points at is the entry point.
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.find((n) => !targets.has(n.id)) ?? graph.nodes[0] ?? null;
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export function validateAnswer(
  value: string,
  validation: FlowNodeData['validation'],
): { ok: boolean; normalised: string } {
  const trimmed = value.trim();
  switch (validation) {
    case 'email':
      return { ok: EMAIL_RE.test(trimmed), normalised: trimmed.toLowerCase() };
    case 'phone': {
      const digits = trimmed.replace(/[^\d+]/g, '');
      return { ok: digits.replace(/\D/g, '').length >= 7, normalised: digits };
    }
    case 'number': {
      const n = Number(trimmed.replace(/[^\d.-]/g, ''));
      return { ok: Number.isFinite(n) && trimmed !== '', normalised: String(n) };
    }
    case 'date': {
      const d = new Date(trimmed);
      return { ok: !Number.isNaN(d.getTime()), normalised: Number.isNaN(d.getTime()) ? trimmed : d.toISOString().slice(0, 10) };
    }
    case 'url':
      return { ok: URL_RE.test(trimmed), normalised: trimmed };
    default:
      return { ok: trimmed.length > 0, normalised: trimmed };
  }
}

function compare(actual: unknown, operator: ConditionOperator, expected: string | undefined): boolean {
  const a = actual === undefined || actual === null ? '' : String(actual);
  const b = expected ?? '';
  switch (operator) {
    case 'equals':
      return a.toLowerCase() === b.toLowerCase();
    case 'not_equals':
      return a.toLowerCase() !== b.toLowerCase();
    case 'contains':
      return a.toLowerCase().includes(b.toLowerCase());
    case 'not_contains':
      return !a.toLowerCase().includes(b.toLowerCase());
    case 'starts_with':
      return a.toLowerCase().startsWith(b.toLowerCase());
    case 'is_set':
      return a.trim() !== '';
    case 'is_empty':
      return a.trim() === '';
    case 'greater_than':
      return Number(a) > Number(b);
    case 'less_than':
      return Number(a) < Number(b);
    default:
      return false;
  }
}

function evaluateCondition(data: FlowNodeData, state: FlowState): boolean {
  const clauses = data.conditions ?? [];
  if (clauses.length === 0) return true;
  const results = clauses.map((c) => compare(state[c.variable], c.operator, c.value));
  return data.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Match a customer's reply to one of a node's choices.
 * Accepts the payload, the visible label, or the 1-based position — channels
 * that cannot render buttons leave people typing "2".
 */
export function matchChoice(choices: FlowChoice[], input: string): FlowChoice | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  const byValue = choices.find((c) => (c.value ?? c.id).toLowerCase() === value);
  if (byValue) return byValue;
  const byId = choices.find((c) => c.id.toLowerCase() === value);
  if (byId) return byId;
  const byLabel = choices.find((c) => c.label.trim().toLowerCase() === value);
  if (byLabel) return byLabel;
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1] ?? null;
  return null;
}

interface RunParams {
  graph: FlowGraph;
  /** Where to begin. Null starts at the flow's entry node. */
  startNodeId?: string | null;
  state?: FlowState;
  /** The message being processed, when resuming a parked node. */
  input?: string | null;
  deps?: EngineDeps;
}

/**
 * Execute the graph until it produces something to send and needs an answer,
 * finishes, or hands the turn to the AI / a human.
 */
export async function runFlow(params: RunParams): Promise<EngineResult> {
  const { graph } = params;
  const deps = params.deps ?? {};
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const state: FlowState = { ...(params.state ?? {}) };
  const blocks: OutboundBlock[] = [];
  const effects: FlowEffect[] = [];

  const result = (over: Partial<EngineResult>): EngineResult => ({
    blocks,
    state,
    awaitingNodeId: null,
    completed: false,
    handoffToAi: false,
    handoffToHuman: false,
    effects,
    ...over,
  });

  // --- Resume: the previous turn parked on a node awaiting this input --------
  let cursor: string | null;
  const parked = findNode(graph, params.startNodeId ?? null);
  const resuming = parked !== null && WAITING_NODE_TYPES.includes(parked.type) && params.input != null;

  if (resuming && parked) {
    const input = params.input ?? '';
    effects.push({ type: 'node', nodeId: parked.id, nodeType: parked.type, event: 'answered' });

    if (parked.type === 'ask') {
      const { ok, normalised } = validateAnswer(input, parked.data.validation);
      if (!ok) {
        const attempts = Number(state[`__retry_${parked.id}`] ?? 0) + 1;
        const maxRetries = parked.data.maxRetries ?? 2;
        if (attempts <= maxRetries) {
          state[`__retry_${parked.id}`] = attempts;
          blocks.push({
            type: 'text',
            text: interpolate(parked.data.retryText || 'Sorry, that does not look right. Could you try again?', state),
          });
          return result({ awaitingNodeId: parked.id });
        }
        // Out of retries: keep the raw answer and move on rather than trapping
        // the customer in a validation loop.
      }
      if (parked.data.variable) state[parked.data.variable] = ok ? normalised : input.trim();
      delete state[`__retry_${parked.id}`];
      cursor = nextNodeId(graph, parked.id, 'default');
    } else if (parked.type === 'csat') {
      const rating = Number(input.trim().replace(/[^\d]/g, ''));
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        state.csat_rating = rating;
        effects.push({ type: 'csat' });
        cursor = nextNodeId(graph, parked.id, 'default');
      } else {
        blocks.push({
          type: 'text',
          text: interpolate(parked.data.retryText || 'Please reply with a number from 1 to 5.', state),
        });
        return result({ awaitingNodeId: parked.id });
      }
    } else {
      const choices = choicesOf(parked.data);
      const chosen = matchChoice(choices, input);
      if (chosen) {
        if (parked.data.variable) state[parked.data.variable] = chosen.value ?? chosen.label;
        state.last_choice = chosen.value ?? chosen.label;
        cursor = nextNodeId(graph, parked.id, chosen.id);
        // A choice with no wire of its own falls through to the node's default
        // output, so a builder can wire one path for every button.
        if (!cursor) cursor = nextNodeId(graph, parked.id, 'default');
      } else {
        const fallback = nextNodeId(graph, parked.id, 'fallback');
        if (fallback) {
          state.last_choice = input.trim();
          cursor = fallback;
        } else {
          // Unrecognised answer and no fallback wired: let the AI take this turn
          // rather than repeating the buttons at the customer.
          return result({ awaitingNodeId: parked.id, handoffToAi: true });
        }
      }
    }
  } else {
    const start = params.startNodeId ? findNode(graph, params.startNodeId) : findStartNode(graph);
    if (!start) return result({ completed: true });
    cursor = start.type === 'start' ? nextNodeId(graph, start.id, 'default') : start.id;
  }

  // --- Walk forward ---------------------------------------------------------
  let steps = 0;
  const visited = new Set<string>();

  while (cursor && steps < maxSteps) {
    steps += 1;
    const node = findNode(graph, cursor);
    if (!node) break;

    // A node revisited without any wait in between means a wiring loop.
    if (visited.has(node.id)) {
      effects.push({ type: 'node', nodeId: node.id, nodeType: node.type, event: 'error' });
      break;
    }
    visited.add(node.id);
    effects.push({ type: 'node', nodeId: node.id, nodeType: node.type, event: 'entered' });

    switch (node.type) {
      case 'start':
        cursor = nextNodeId(graph, node.id, 'default');
        break;

      case 'message': {
        const text = interpolate(node.data.text, state);
        if (text) blocks.push({ type: 'text', text });
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'image':
      case 'video': {
        const url = interpolate(node.data.url, state);
        if (url) blocks.push({ type: node.type, url, caption: interpolate(node.data.caption, state) || undefined });
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'file': {
        const url = interpolate(node.data.url, state);
        if (url) blocks.push({ type: 'file', url, name: node.data.fileName });
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'gallery': {
        const items = (node.data.items ?? [])
          .filter((i) => i && i.title)
          .map((i) => ({
            title: interpolate(i.title, state),
            subtitle: i.subtitle ? interpolate(i.subtitle, state) : undefined,
            imageUrl: i.imageUrl ? interpolate(i.imageUrl, state) : undefined,
            buttons: i.buttons?.length ? toButtons(i.buttons, state) : undefined,
          }));
        if (items.length) blocks.push({ type: 'gallery', items });
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'ask': {
        const text = interpolate(node.data.text, state);
        if (text) blocks.push({ type: 'text', text });
        return result({ awaitingNodeId: node.id });
      }

      case 'buttons':
      case 'quick_replies': {
        const choices = choicesOf(node.data);
        const text = interpolate(node.data.text, state) || ' ';
        if (choices.length === 0) {
          // A choice block with no choices is just a message.
          if (text.trim()) blocks.push({ type: 'text', text });
          cursor = nextNodeId(graph, node.id, 'default');
          break;
        }
        blocks.push(
          node.type === 'buttons'
            ? { type: 'buttons', text, buttons: toButtons(choices, state) }
            : { type: 'quick_replies', text, options: toButtons(choices, state) },
        );
        return result({ awaitingNodeId: node.id });
      }

      case 'csat': {
        const text =
          interpolate(node.data.text, state) || 'How would you rate this conversation from 1 to 5?';
        blocks.push({
          type: 'quick_replies',
          text,
          options: [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n) })),
        });
        return result({ awaitingNodeId: node.id });
      }

      case 'condition': {
        const pass = evaluateCondition(node.data, state);
        cursor = nextNodeId(graph, node.id, pass ? 'true' : 'false');
        break;
      }

      case 'random': {
        // Split traffic evenly across every wired output — A/B testing a path.
        const outs = graph.edges.filter((e) => e.source === node.id);
        cursor = outs.length ? (outs[Math.floor(Math.random() * outs.length)]?.target ?? null) : null;
        break;
      }

      case 'delay': {
        const ms = Math.max(0, (node.data.seconds ?? 0) * 1000);
        const cap = deps.maxInlineDelayMs ?? DEFAULT_MAX_INLINE_DELAY_MS;
        // A webhook must answer quickly, so only short "typing" pauses are real.
        if (ms > 0) await sleep(Math.min(ms, cap));
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'tag':
        if (node.data.tags?.length) effects.push({ type: 'tag', tags: node.data.tags });
        cursor = nextNodeId(graph, node.id, 'default');
        break;

      case 'assign':
        effects.push({ type: 'assign', agentId: node.data.agentId });
        cursor = nextNodeId(graph, node.id, 'default');
        break;

      case 'subscribe':
        effects.push({ type: 'subscribe', optIn: node.data.optIn !== false });
        cursor = nextNodeId(graph, node.id, 'default');
        break;

      case 'save_lead': {
        const fields: Record<string, string> = {};
        for (const [key, template] of Object.entries(node.data.leadFields ?? {})) {
          const value = interpolate(template, state);
          if (value) fields[key] = value;
        }
        effects.push({ type: 'save_lead', fields });
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'handoff': {
        const text = interpolate(node.data.text, state);
        if (text) blocks.push({ type: 'text', text });
        effects.push({ type: 'handoff' });
        return result({ completed: true, handoffToHuman: true });
      }

      case 'http': {
        const ok = await runHttpNode(node, state, deps);
        cursor = nextNodeId(graph, node.id, ok ? 'true' : 'false') ?? nextNodeId(graph, node.id, 'default');
        if (!ok) effects.push({ type: 'node', nodeId: node.id, nodeType: node.type, event: 'error' });
        break;
      }

      case 'ai': {
        // Let the assistant answer this turn, then continue from the next node
        // on the following message.
        const next = nextNodeId(graph, node.id, 'default');
        return result({
          awaitingNodeId: next,
          handoffToAi: true,
          aiInstruction: interpolate(node.data.instruction, state) || undefined,
        });
      }

      case 'jump': {
        if (node.data.targetFlowId) {
          effects.push({ type: 'jump', flowId: node.data.targetFlowId });
          return result({ completed: true, jumpFlowId: node.data.targetFlowId });
        }
        cursor = nextNodeId(graph, node.id, 'default');
        break;
      }

      case 'end': {
        const text = interpolate(node.data.text, state);
        if (text) blocks.push({ type: 'text', text });
        return result({ completed: true });
      }

      default:
        cursor = nextNodeId(graph, node.id, 'default');
        break;
    }
  }

  return result({ completed: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read a dotted path out of a JSON response ("data.items.0.id"). */
export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

async function runHttpNode(node: FlowNode, state: FlowState, deps: EngineDeps): Promise<boolean> {
  const url = interpolate(node.data.url, state);
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const doFetch = deps.httpFetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(node.data.headers ?? {})) headers[k] = interpolate(v, state);
    const method = node.data.method ?? 'GET';
    const res = await doFetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : interpolate(node.data.body, state),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    for (const [variable, path] of Object.entries(node.data.responseMap ?? {})) {
      const value = readPath(json, path);
      state[variable] =
        value === undefined || value === null
          ? null
          : typeof value === 'object'
            ? JSON.stringify(value)
            : (value as string | number | boolean);
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
