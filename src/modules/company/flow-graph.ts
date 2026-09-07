/**
 * Pure graph helpers for the visual flow builder.
 *
 * IMPORTANT: this file has **no runtime imports on purpose**. Everything it
 * pulls from `@/lib/flows/types` is `import type`, which TypeScript elides, so
 * `scripts/test-flow-builder.mjs` can transpile it with `ts.transpileModule`
 * and exercise the real validation rules and the real templates — not a
 * re-implementation of them. Keep it that way: no `@/lib/db`, no `next/*`, no
 * React. Anything needing a database belongs in `flows-data.ts` /
 * `flows-actions.ts`, and anything needing the DOM belongs in the builder
 * components.
 *
 * The geometry constants live here too, because the canvas draws edges from
 * arithmetic rather than from measured DOM boxes — see `outputHandles`.
 */
import type {
  ConditionOperator,
  FlowChoice,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeData,
  FlowNodeType,
} from '@/lib/flows/types';

// ---------------------------------------------------------------------------
// Canvas geometry
//
// Edge endpoints are computed, never measured. A node card is a fixed width and
// renders its output handles at fixed offsets, so the SVG layer can place every
// bezier without reading a single `getBoundingClientRect()` — which is what
// makes dragging a node cheap enough to do with direct DOM writes instead of a
// React render per mousemove.
// ---------------------------------------------------------------------------
export const NODE_WIDTH = 248;
/** Vertical centre of the single input handle, relative to the card's top. */
export const INPUT_PORT_Y = 28;
/** Vertical centre of the first output handle. */
export const FIRST_PORT_Y = 58;
/** Distance between consecutive output handles. */
export const PORT_GAP = 26;
export const MIN_NODE_HEIGHT = 76;

export interface HandleSpec {
  /** Written to the edge's `sourceHandle` — the engine reads exactly this. */
  id: string;
  label: string;
  tone: 'default' | 'true' | 'false' | 'fallback';
}

/**
 * The outputs a node offers, in render order.
 *
 * These ids are a contract with `src/lib/flows/engine.ts`: a choice's own id for
 * button / quick-reply outputs, `'true'`/`'false'` for `condition` and `http`,
 * `'fallback'` for the unmatched-answer path, `'default'` for everything else.
 */
export function outputHandles(node: FlowNode): HandleSpec[] {
  switch (node.type) {
    case 'buttons':
    case 'quick_replies': {
      const choices = node.data.choices ?? [];
      const handles: HandleSpec[] = choices.map((c, i) => ({
        id: c.id,
        label: c.label?.trim() ? c.label : `Choice ${i + 1}`,
        tone: 'default',
      }));
      handles.push({ id: 'fallback', label: 'Anything else', tone: 'fallback' });
      return handles;
    }
    case 'condition':
    case 'http':
      return [
        { id: 'true', label: node.type === 'http' ? 'Succeeded' : 'Yes', tone: 'true' },
        { id: 'false', label: node.type === 'http' ? 'Failed' : 'No', tone: 'false' },
      ];
    case 'random':
      return [
        { id: 'a', label: 'Variant A', tone: 'default' },
        { id: 'b', label: 'Variant B', tone: 'default' },
      ];
    // Terminal blocks: nothing runs after them.
    case 'end':
    case 'handoff':
      return [];
    case 'jump':
      // A jump with a target flow is terminal; without one it falls through.
      return node.data.targetFlowId ? [] : [{ id: 'default', label: 'Next', tone: 'default' }];
    default:
      return [{ id: 'default', label: 'Next', tone: 'default' }];
  }
}

export function nodeHeight(node: FlowNode): number {
  const ports = outputHandles(node).length;
  return Math.max(MIN_NODE_HEIGHT, FIRST_PORT_Y + Math.max(ports - 1, 0) * PORT_GAP + 22);
}

/** Absolute canvas coordinates of a node's input handle. */
export function inputPoint(node: FlowNode): { x: number; y: number } {
  return { x: node.position.x, y: node.position.y + INPUT_PORT_Y };
}

/** Absolute canvas coordinates of one of a node's output handles. */
export function outputPoint(node: FlowNode, handleId: string): { x: number; y: number } {
  const handles = outputHandles(node);
  const index = handles.findIndex((h) => h.id === handleId);
  const row = index < 0 ? 0 : index;
  return { x: node.position.x + NODE_WIDTH, y: node.position.y + FIRST_PORT_Y + row * PORT_GAP };
}

/** Cubic bezier between two ports, flattened enough to read at low zoom. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
export interface PaletteItem {
  type: FlowNodeType;
  label: string;
  hint: string;
}

export interface PaletteGroup {
  group: string;
  items: PaletteItem[];
}

export const PALETTE: PaletteGroup[] = [
  {
    group: 'Content',
    items: [
      { type: 'message', label: 'Message', hint: 'Send a line of text.' },
      { type: 'image', label: 'Image', hint: 'Send a picture with an optional caption.' },
      { type: 'video', label: 'Video', hint: 'Send a video link.' },
      { type: 'file', label: 'File', hint: 'Send a document or PDF.' },
      { type: 'gallery', label: 'Gallery', hint: 'A swipeable card carousel.' },
    ],
  },
  {
    group: 'Questions',
    items: [
      { type: 'ask', label: 'Ask a question', hint: 'Save the reply into a variable.' },
      { type: 'buttons', label: 'Buttons', hint: 'Tappable choices, one path each.' },
      { type: 'quick_replies', label: 'Quick replies', hint: 'Suggestion chips under the message.' },
      { type: 'csat', label: 'Rating', hint: 'Ask for a 1–5 satisfaction score.' },
    ],
  },
  {
    group: 'Logic',
    items: [
      { type: 'condition', label: 'Condition', hint: 'Branch on what you already know.' },
      { type: 'random', label: 'Split test', hint: 'Send traffic down two paths.' },
      { type: 'delay', label: 'Wait', hint: 'Pause before the next block.' },
      { type: 'jump', label: 'Go to flow', hint: 'Hand the conversation to another flow.' },
      { type: 'end', label: 'End', hint: 'Finish the flow here.' },
    ],
  },
  {
    group: 'Actions',
    items: [
      { type: 'tag', label: 'Add tag', hint: 'Label the contact for segmenting.' },
      { type: 'assign', label: 'Assign', hint: 'Route the chat to a teammate.' },
      { type: 'handoff', label: 'Human handoff', hint: 'Escalate to a live agent.' },
      { type: 'save_lead', label: 'Save lead', hint: 'Write the answers to your leads list.' },
      { type: 'http', label: 'Call an API', hint: 'GET/POST to your own system.' },
      { type: 'ai', label: 'Let AI answer', hint: 'Hand this turn to the assistant.' },
      { type: 'subscribe', label: 'Subscribe', hint: 'Opt the contact in or out of broadcasts.' },
    ],
  },
];

const NODE_LABELS: Record<FlowNodeType, string> = {
  start: 'Start',
  message: 'Message',
  image: 'Image',
  video: 'Video',
  file: 'File',
  gallery: 'Gallery',
  ask: 'Ask a question',
  buttons: 'Buttons',
  quick_replies: 'Quick replies',
  csat: 'Rating',
  condition: 'Condition',
  random: 'Split test',
  delay: 'Wait',
  jump: 'Go to flow',
  end: 'End',
  tag: 'Add tag',
  assign: 'Assign',
  handoff: 'Human handoff',
  save_lead: 'Save lead',
  http: 'Call an API',
  ai: 'Let AI answer',
  subscribe: 'Subscribe',
};

export function nodeTypeLabel(type: FlowNodeType): string {
  return NODE_LABELS[type] ?? type;
}

/** How a node is named in problem lists and on the canvas header. */
export function nodeTitle(node: FlowNode): string {
  const custom = node.data.label?.trim();
  if (custom) return custom;
  const text = node.data.text?.trim();
  if (text) return text.length > 34 ? `${text.slice(0, 34)}…` : text;
  return nodeTypeLabel(node.type);
}

const GROUP_OF: Partial<Record<FlowNodeType, 'content' | 'questions' | 'logic' | 'actions'>> = {};
for (const group of PALETTE) {
  for (const item of group.items) {
    GROUP_OF[item.type] = group.group.toLowerCase() as 'content' | 'questions' | 'logic' | 'actions';
  }
}

export function nodeGroup(type: FlowNodeType): 'content' | 'questions' | 'logic' | 'actions' {
  return GROUP_OF[type] ?? 'content';
}

// ---------------------------------------------------------------------------
// Node + id creation
// ---------------------------------------------------------------------------

/** Short, readable, collision-checked id (`msg_3`, `btn_1`, …). */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}_${n}`)) n += 1;
  return `${prefix}_${n}`;
}

const ID_PREFIX: Record<FlowNodeType, string> = {
  start: 'start',
  message: 'msg',
  image: 'img',
  video: 'vid',
  file: 'file',
  gallery: 'gal',
  ask: 'ask',
  buttons: 'btn',
  quick_replies: 'qr',
  csat: 'csat',
  condition: 'if',
  random: 'split',
  delay: 'wait',
  jump: 'jump',
  end: 'end',
  tag: 'tag',
  assign: 'assign',
  handoff: 'human',
  save_lead: 'lead',
  http: 'api',
  ai: 'ai',
  subscribe: 'sub',
};

export function defaultNodeData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case 'message':
      return { text: 'Hi there! How can we help?' };
    case 'ask':
      return { text: 'What is your name?', variable: 'name', validation: 'text', maxRetries: 2 };
    case 'buttons':
      return {
        text: 'What would you like to do?',
        choices: [
          { id: 'c1', label: 'Option one' },
          { id: 'c2', label: 'Option two' },
        ],
      };
    case 'quick_replies':
      return {
        text: 'Pick one:',
        choices: [
          { id: 'q1', label: 'Yes' },
          { id: 'q2', label: 'No' },
        ],
      };
    case 'csat':
      return { text: 'How did we do? Rate us from 1 to 5.' };
    case 'condition':
      return { match: 'all', conditions: [{ variable: 'name', operator: 'is_set' }] };
    case 'delay':
      return { seconds: 2 };
    case 'tag':
      return { tags: [] };
    case 'http':
      return { method: 'GET', url: '', headers: {}, responseMap: {} };
    case 'ai':
      return { instruction: '' };
    case 'save_lead':
      return { leadFields: { name: '{{name}}', email: '{{email}}' } };
    case 'subscribe':
      return { optIn: true };
    case 'end':
      return { text: 'Thanks for chatting!' };
    case 'handoff':
      return { text: 'Connecting you with a teammate now.' };
    case 'gallery':
      return { items: [{ title: 'Item one', subtitle: '', imageUrl: '' }] };
    default:
      return {};
  }
}

export function createNode(
  type: FlowNodeType,
  position: { x: number; y: number },
  taken: Iterable<string>,
): FlowNode {
  return {
    id: newId(ID_PREFIX[type] ?? 'node', taken),
    type,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    data: defaultNodeData(type),
  };
}

export function newChoice(existing: FlowChoice[]): FlowChoice {
  return { id: newId('c', existing.map((c) => c.id)), label: 'New choice' };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export interface GraphProblem {
  message: string;
  /** Set when the builder can select the offending block. */
  nodeId?: string;
}

/**
 * Server-side gate before a graph goes live.
 *
 * The four rules the product cares about, plus two structural guards:
 *   1. exactly one reachable entry point,
 *   2. no unreachable block,
 *   3. choice ids unique within a button / quick-reply block,
 *   4. a condition has at least one clause,
 *   5. the graph is not empty,
 *   6. no edge points at a block that no longer exists.
 *
 * Returns problems rather than throwing so the builder can list them all at
 * once and highlight each block, instead of surfacing them one save at a time.
 */
export function validateGraph(graph: FlowGraph): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  if (nodes.length === 0) {
    return [{ message: 'This flow has no blocks yet. Add a block before publishing.' }];
  }

  const byId = new Map<string, FlowNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      problems.push({ nodeId: node.id, message: `Two blocks share the id "${node.id}".` });
    }
    byId.set(node.id, node);
  }

  // --- 6. dangling edges --------------------------------------------------
  for (const edge of edges) {
    if (!byId.has(edge.source)) {
      problems.push({ message: `A connection starts from a block that no longer exists (${edge.source}).` });
    }
    if (!byId.has(edge.target)) {
      problems.push({
        nodeId: byId.has(edge.source) ? edge.source : undefined,
        message: `A connection points at a block that no longer exists (${edge.target}).`,
      });
    }
  }

  // --- 1. entry point ------------------------------------------------------
  const starts = nodes.filter((n) => n.type === 'start');
  const incoming = new Set(edges.filter((e) => byId.has(e.source)).map((e) => e.target));
  const roots = nodes.filter((n) => !incoming.has(n.id));
  let entry: FlowNode | null = null;

  if (starts.length > 1) {
    problems.push({
      nodeId: starts[1]?.id,
      message: `This flow has ${starts.length} Start blocks. Keep exactly one so it is clear where a conversation begins.`,
    });
    entry = starts[0] ?? null;
  } else if (starts.length === 1) {
    entry = starts[0] ?? null;
  } else if (roots.length === 0) {
    problems.push({
      message:
        'Every block has a connection pointing at it, so there is no entry point — the wiring is a closed loop. Add a Start block.',
    });
  } else if (roots.length > 1) {
    problems.push({
      message: `This flow has ${roots.length} possible entry points (${roots
        .map((n) => `"${nodeTitle(n)}"`)
        .join(', ')}). Connect them together or add a single Start block.`,
    });
    entry = roots[0] ?? null;
  } else {
    entry = roots[0] ?? null;
  }

  // --- 2. reachability -----------------------------------------------------
  if (entry) {
    const seen = new Set<string>([entry.id]);
    const queue = [entry.id];
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      for (const edge of edges) {
        if (edge.source !== current) continue;
        if (seen.has(edge.target) || !byId.has(edge.target)) continue;
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
    for (const node of nodes) {
      if (!seen.has(node.id)) {
        problems.push({
          nodeId: node.id,
          message: `"${nodeTitle(node)}" can never be reached — nothing connects to it from the start of the flow.`,
        });
      }
    }
  }

  // --- 3 & 4. per-node rules ----------------------------------------------
  for (const node of nodes) {
    if (node.type === 'buttons' || node.type === 'quick_replies') {
      const choices = node.data.choices ?? [];
      if (choices.length === 0) {
        problems.push({
          nodeId: node.id,
          message: `"${nodeTitle(node)}" has no choices, so nobody can answer it.`,
        });
      }
      const seenChoice = new Set<string>();
      for (const choice of choices) {
        const id = (choice?.id ?? '').trim();
        if (!id) {
          problems.push({ nodeId: node.id, message: `A choice in "${nodeTitle(node)}" has no id.` });
          continue;
        }
        if (seenChoice.has(id)) {
          problems.push({
            nodeId: node.id,
            message: `"${nodeTitle(node)}" uses the choice id "${id}" twice. Each choice needs its own id or its path cannot be told apart.`,
          });
        }
        seenChoice.add(id);
        if (!choice.label?.trim()) {
          problems.push({ nodeId: node.id, message: `A choice in "${nodeTitle(node)}" has no label.` });
        }
      }
    }

    if (node.type === 'condition' && (node.data.conditions ?? []).length === 0) {
      problems.push({
        nodeId: node.id,
        message: `"${nodeTitle(node)}" has no rules to check, so it would always take the Yes path.`,
      });
    }

    if (node.type === 'ask' && !node.data.variable?.trim()) {
      problems.push({
        nodeId: node.id,
        message: `"${nodeTitle(node)}" does not say where to save the answer. Give it a variable name.`,
      });
    }
  }

  return problems;
}

export function problemMessages(graph: FlowGraph): string[] {
  return validateGraph(graph).map((p) => p.message);
}

// ---------------------------------------------------------------------------
// Version planning
//
// Saving is "snapshot what is there, then write the new graph one version up",
// and restoring is the same move with an older graph — which is why an undo of
// a restore is just another restore. Kept pure so the test script can assert the
// numbering without a database.
// ---------------------------------------------------------------------------
export interface VersionSnapshot {
  version: number;
  graph: FlowGraph;
}

export interface VersionPlan {
  /** The row to write into `flow_versions` before overwriting `flows`. */
  snapshot: VersionSnapshot;
  nextVersion: number;
  graph: FlowGraph;
}

export function planGraphSave(current: VersionSnapshot, next: FlowGraph): VersionPlan {
  return {
    snapshot: { version: current.version, graph: current.graph },
    nextVersion: current.version + 1,
    graph: next,
  };
}

export function planVersionRestore(current: VersionSnapshot, target: VersionSnapshot): VersionPlan {
  // The graph being replaced is snapshotted first, so restoring the wrong
  // version is itself undoable.
  return {
    snapshot: { version: current.version, graph: current.graph },
    nextVersion: current.version + 1,
    graph: target.graph,
  };
}

// ---------------------------------------------------------------------------
// Trigger copy
// ---------------------------------------------------------------------------
export interface TriggerLike {
  type: 'keyword' | 'referral' | 'ad' | 'comment' | 'intent' | 'welcome' | 'event';
  matchValue: string;
  matchMode: 'exact' | 'contains' | 'starts_with' | 'regex';
  channels?: string[];
  isActive?: boolean;
}

const MATCH_COPY: Record<TriggerLike['matchMode'], string> = {
  exact: 'is exactly',
  contains: 'contains',
  starts_with: 'starts with',
  regex: 'matches the pattern',
};

/** One plain-English sentence: "when a message contains 'pricing' on WhatsApp". */
export function describeTrigger(trigger: TriggerLike): string {
  const where = trigger.channels?.length
    ? ` on ${trigger.channels.map((c) => c.replace(/_/g, ' ')).join(', ')}`
    : ' on every channel';
  const value = trigger.matchValue?.trim();
  switch (trigger.type) {
    case 'keyword':
      return `When a message ${MATCH_COPY[trigger.matchMode]} "${value || '…'}"${where}.`;
    case 'referral':
      return `When someone arrives with the ref parameter "${value || '…'}"${where}.`;
    case 'ad':
      return `When someone messages from Facebook ad ${value || '…'}${where}.`;
    case 'comment':
      return `When someone comments "${value || 'anything'}" on your post${where}.`;
    case 'intent':
      return `When the AI recognises the intent "${value || '…'}"${where}.`;
    case 'welcome':
      return `On the first message of a brand-new conversation${where}.`;
    case 'event':
      return `When your system sends the custom event "${value || '…'}"${where}.`;
    default:
      return 'This trigger has no description yet.';
  }
}

export const TRIGGER_TYPE_LABELS: Record<TriggerLike['type'], string> = {
  keyword: 'Keyword',
  referral: 'Referral / ref link',
  ad: 'Facebook ad',
  comment: 'Post comment',
  intent: 'AI intent',
  welcome: 'New conversation',
  event: 'Custom event',
};

// ---------------------------------------------------------------------------
// Templates
//
// Every template must pass `validateGraph` — `scripts/test-flow-builder.mjs`
// asserts exactly that, so a template can never ship a graph the publish gate
// would reject.
// ---------------------------------------------------------------------------
export interface FlowTemplate {
  key: string;
  name: string;
  description: string;
  /** Seeded alongside the flow so a new template is reachable immediately. */
  trigger?: TriggerLike;
  build: () => FlowGraph;
}

const COL = 300;
const ROW = 150;

function node(
  id: string,
  type: FlowNodeType,
  col: number,
  row: number,
  data: FlowNodeData,
): FlowNode {
  return { id, type, position: { x: 60 + col * COL, y: 60 + row * ROW }, data };
}

function edge(source: string, target: string, sourceHandle = 'default'): FlowEdge {
  return { id: `${source}:${sourceHandle}->${target}`, source, sourceHandle, target };
}

function clause(variable: string, operator: ConditionOperator, value?: string) {
  return { variable, operator, value };
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'welcome_menu',
    name: 'Welcome + menu',
    description:
      'Greets a first-time visitor and offers three ways in. The safest flow to start with — every branch ends politely.',
    trigger: { type: 'welcome', matchValue: '', matchMode: 'contains' },
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 1, { label: 'Conversation starts' }),
        node('msg_1', 'message', 1, 1, {
          text: 'Hi! 👋 Thanks for getting in touch — I can help you right here.',
        }),
        node('btn_1', 'buttons', 2, 1, {
          text: 'What can I help you with?',
          variable: 'menu_choice',
          choices: [
            { id: 'c_sales', label: 'Talk to sales' },
            { id: 'c_support', label: 'I need help' },
            { id: 'c_hours', label: 'Opening hours' },
          ],
        }),
        node('msg_sales', 'message', 3, 0, {
          text: 'Great — I will put you through to the sales team.',
        }),
        node('human_1', 'handoff', 4, 0, { text: 'One moment, connecting you to a teammate…' }),
        node('msg_support', 'message', 3, 1, {
          text: 'Tell me what is going wrong and I will do my best to sort it.',
        }),
        node('ai_1', 'ai', 4, 1, { instruction: 'Answer the support question using the company knowledge base.' }),
        node('msg_hours', 'message', 3, 2, {
          text: 'We are open Monday to Friday, 9am–6pm, and Saturdays 10am–4pm.',
        }),
        node('msg_else', 'message', 3, 3, {
          text: 'No problem — tell me in your own words and I will help.',
        }),
        node('end_1', 'end', 5, 2, { text: 'Anything else? Just message me any time.' }),
      ],
      edges: [
        edge('start_1', 'msg_1'),
        edge('msg_1', 'btn_1'),
        edge('btn_1', 'msg_sales', 'c_sales'),
        edge('btn_1', 'msg_support', 'c_support'),
        edge('btn_1', 'msg_hours', 'c_hours'),
        edge('btn_1', 'msg_else', 'fallback'),
        edge('msg_sales', 'human_1'),
        edge('msg_support', 'ai_1'),
        edge('ai_1', 'end_1'),
        edge('msg_hours', 'end_1'),
        edge('msg_else', 'end_1'),
      ],
    }),
  },
  {
    key: 'lead_capture',
    name: 'Lead capture',
    description:
      'Collects a name, email and phone number, validates each answer, then writes the contact to your leads list.',
    trigger: { type: 'keyword', matchValue: 'quote', matchMode: 'contains' },
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 1, { label: 'Conversation starts' }),
        node('msg_1', 'message', 1, 1, {
          text: 'Happy to get you a quote — three quick questions and someone will come back to you.',
        }),
        node('ask_name', 'ask', 2, 1, {
          text: 'First up, what is your name?',
          variable: 'name',
          validation: 'text',
          retryText: 'Sorry, I missed that — what should I call you?',
          maxRetries: 2,
        }),
        node('ask_email', 'ask', 3, 1, {
          text: 'Thanks {{name}}! What is the best email for you?',
          variable: 'email',
          validation: 'email',
          retryText: 'That does not look like an email address. Could you try again?',
          maxRetries: 2,
        }),
        node('ask_phone', 'ask', 4, 1, {
          text: 'And a phone number, in case email bounces?',
          variable: 'phone',
          validation: 'phone',
          retryText: 'Hmm, that number looks short. Could you include the area code?',
          maxRetries: 2,
        }),
        node('lead_1', 'save_lead', 5, 1, {
          leadFields: { name: '{{name}}', email: '{{email}}', phone: '{{phone}}' },
        }),
        node('tag_1', 'tag', 6, 1, { tags: ['quote-request'] }),
        node('end_1', 'end', 7, 1, {
          text: 'Perfect — we have everything we need, {{name}}. Someone will email you within one business day.',
        }),
      ],
      edges: [
        edge('start_1', 'msg_1'),
        edge('msg_1', 'ask_name'),
        edge('ask_name', 'ask_email'),
        edge('ask_email', 'ask_phone'),
        edge('ask_phone', 'lead_1'),
        edge('lead_1', 'tag_1'),
        edge('tag_1', 'end_1'),
      ],
    }),
  },
  {
    key: 'faq_menu',
    name: 'FAQ menu',
    description:
      'Answers the four questions you get asked most, and quietly hands anything else to the AI instead of dead-ending.',
    trigger: { type: 'keyword', matchValue: 'help', matchMode: 'contains' },
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 1, { label: 'Conversation starts' }),
        node('qr_1', 'quick_replies', 1, 1, {
          text: 'Here are the things people ask most. Which one is you?',
          variable: 'faq_topic',
          choices: [
            { id: 'f_pricing', label: 'Pricing' },
            { id: 'f_delivery', label: 'Delivery' },
            { id: 'f_returns', label: 'Returns' },
            { id: 'f_contact', label: 'Contact a human' },
          ],
        }),
        node('msg_pricing', 'message', 2, 0, {
          text: 'Plans start at £29/month and every plan includes support. Full pricing is on our website.',
        }),
        node('msg_delivery', 'message', 2, 1, {
          text: 'Standard delivery is 2–3 working days, and next-day is available before 3pm.',
        }),
        node('msg_returns', 'message', 2, 2, {
          text: 'You have 30 days to return anything unused — we email you a prepaid label.',
        }),
        node('human_1', 'handoff', 2, 3, { text: 'Sure — putting you through to the team now.' }),
        node('ai_1', 'ai', 2, 4, {
          instruction: 'The customer asked something outside the FAQ menu. Answer it from the knowledge base.',
        }),
        node('qr_again', 'quick_replies', 3, 1, {
          text: 'Did that answer it?',
          variable: 'faq_resolved',
          choices: [
            { id: 'r_yes', label: 'Yes, thanks' },
            { id: 'r_no', label: 'Not really' },
          ],
        }),
        node('csat_1', 'csat', 4, 0, { text: 'Glad to help! How would you rate this chat from 1 to 5?' }),
        node('human_2', 'handoff', 4, 2, { text: 'Let me get a person on this for you.' }),
        node('end_1', 'end', 5, 0, { text: 'Thanks for the feedback — message me any time.' }),
      ],
      edges: [
        edge('start_1', 'qr_1'),
        edge('qr_1', 'msg_pricing', 'f_pricing'),
        edge('qr_1', 'msg_delivery', 'f_delivery'),
        edge('qr_1', 'msg_returns', 'f_returns'),
        edge('qr_1', 'human_1', 'f_contact'),
        edge('qr_1', 'ai_1', 'fallback'),
        edge('msg_pricing', 'qr_again'),
        edge('msg_delivery', 'qr_again'),
        edge('msg_returns', 'qr_again'),
        edge('ai_1', 'qr_again'),
        edge('qr_again', 'csat_1', 'r_yes'),
        edge('qr_again', 'human_2', 'r_no'),
        edge('qr_again', 'human_2', 'fallback'),
        edge('csat_1', 'end_1'),
      ],
    }),
  },
  {
    key: 'book_appointment',
    name: 'Book an appointment',
    description:
      'Picks a service, checks the date is real, collects contact details, and saves the booking request as a lead.',
    trigger: { type: 'keyword', matchValue: 'book', matchMode: 'contains' },
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 1, { label: 'Conversation starts' }),
        node('btn_service', 'buttons', 1, 1, {
          text: 'Let us get you booked in. What do you need?',
          variable: 'service',
          choices: [
            { id: 's_consult', label: 'Consultation' },
            { id: 's_repair', label: 'Repair' },
            { id: 's_other', label: 'Something else' },
          ],
        }),
        node('ask_date', 'ask', 2, 1, {
          text: 'What day suits you? (e.g. 14 March)',
          variable: 'preferred_date',
          validation: 'date',
          retryText: 'I could not read that as a date — try something like "14 March".',
          maxRetries: 2,
        }),
        node('ask_time', 'ask', 3, 1, {
          text: 'Morning or afternoon?',
          variable: 'preferred_time',
          validation: 'text',
          maxRetries: 2,
        }),
        node('ask_name', 'ask', 4, 1, {
          text: 'And your name?',
          variable: 'name',
          validation: 'text',
          maxRetries: 2,
        }),
        node('ask_email', 'ask', 5, 1, {
          text: 'Where should we send the confirmation?',
          variable: 'email',
          validation: 'email',
          retryText: 'That does not look like an email address — could you check it?',
          maxRetries: 2,
        }),
        node('lead_1', 'save_lead', 6, 1, {
          leadFields: {
            name: '{{name}}',
            email: '{{email}}',
            notes: '{{service}} on {{preferred_date}} ({{preferred_time}})',
          },
        }),
        node('msg_confirm', 'message', 7, 1, {
          text: 'Booked in provisionally: {{service}} on {{preferred_date}}, {{preferred_time}}. We will email {{email}} to confirm.',
        }),
        node('csat_1', 'csat', 8, 1, { text: 'How easy was that, 1 to 5?' }),
        node('end_1', 'end', 9, 1, { text: 'Thanks {{name}} — see you soon!' }),
      ],
      edges: [
        edge('start_1', 'btn_service'),
        edge('btn_service', 'ask_date', 's_consult'),
        edge('btn_service', 'ask_date', 's_repair'),
        edge('btn_service', 'ask_date', 's_other'),
        edge('btn_service', 'ask_date', 'fallback'),
        edge('ask_date', 'ask_time'),
        edge('ask_time', 'ask_name'),
        edge('ask_name', 'ask_email'),
        edge('ask_email', 'lead_1'),
        edge('lead_1', 'msg_confirm'),
        edge('msg_confirm', 'csat_1'),
        edge('csat_1', 'end_1'),
      ],
    }),
  },
  {
    key: 'order_status',
    name: 'Order status lookup',
    description:
      'Asks for an order number, calls your API, and reads the status back — with a human handoff when the lookup fails.',
    trigger: { type: 'keyword', matchValue: 'where is my order', matchMode: 'contains' },
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 1, { label: 'Conversation starts' }),
        node('ask_order', 'ask', 1, 1, {
          text: 'Sure — what is your order number? It looks like #12345.',
          variable: 'order_number',
          validation: 'text',
          retryText: 'I need the order number from your confirmation email to look it up.',
          maxRetries: 2,
        }),
        node('api_1', 'http', 2, 1, {
          method: 'GET',
          url: 'https://api.example.com/orders/{{order_number}}',
          headers: { Authorization: 'Bearer YOUR_API_KEY' },
          responseMap: { order_status: 'data.status', order_eta: 'data.eta' },
        }),
        node('if_found', 'condition', 3, 0, {
          match: 'all',
          conditions: [clause('order_status', 'is_set')],
        }),
        node('msg_found', 'message', 4, 0, {
          text: 'Order {{order_number}} is {{order_status}} and should arrive {{order_eta}}.',
        }),
        node('msg_missing', 'message', 4, 1, {
          text: 'I could not find an order with that number — let me get a person to check.',
        }),
        node('msg_failed', 'message', 3, 2, {
          text: 'Our order system is not responding right now. I will pass you to the team.',
        }),
        node('human_1', 'handoff', 5, 2, { text: 'Connecting you now…' }),
        node('end_1', 'end', 5, 0, { text: 'Anything else I can check for you?' }),
      ],
      edges: [
        edge('start_1', 'ask_order'),
        edge('ask_order', 'api_1'),
        edge('api_1', 'if_found', 'true'),
        edge('api_1', 'msg_failed', 'false'),
        edge('if_found', 'msg_found', 'true'),
        edge('if_found', 'msg_missing', 'false'),
        edge('msg_found', 'end_1'),
        edge('msg_missing', 'human_1'),
        edge('msg_failed', 'human_1'),
      ],
    }),
  },
  {
    key: 'blank',
    name: 'Blank flow',
    description: 'Just a Start block and a first message. Build the rest yourself.',
    build: () => ({
      nodes: [
        node('start_1', 'start', 0, 0, { label: 'Conversation starts' }),
        node('msg_1', 'message', 1, 0, { text: 'Hi! How can I help?' }),
      ],
      edges: [edge('start_1', 'msg_1')],
    }),
  },
];

export function findTemplate(key: string): FlowTemplate | null {
  return FLOW_TEMPLATES.find((t) => t.key === key) ?? null;
}
