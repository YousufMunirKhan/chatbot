/**
 * The pure half of suggested guided chats: grouping, prompting, and deciding
 * what the model is allowed to have written.
 *
 * NO RUNTIME IMPORTS BEYOND PURE MODULES, deliberately — `@/lib/flows/types`
 * and `@/modules/company/flow-graph` are both free of database, React and
 * `next/*` imports, so this file can be transpiled and exercised on its own the
 * way `scripts/test-flow-builder.mjs` does with the graph helpers. Anything that
 * needs a database or a model lives in `suggest.ts` next door.
 *
 * THE DIVISION THAT MATTERS
 * -------------------------
 * Counting is arithmetic and happens here, over rows the caller loaded. The
 * model never counts, never sees a total, and never writes a number that
 * reaches the owner — it writes a flow, and `sanitiseSuggestedFlow` throws away
 * anything it produced that strays outside that job. This is the same rule
 * `src/lib/ai/insights/rules.ts` holds for insights.
 */
import {
  FLOW_NODE_TYPES,
  type AskValidation,
  type ConditionOperator,
  type FlowChoice,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowNodeData,
  type FlowNodeType,
} from '@/lib/flows/types';

// ---------------------------------------------------------------------------
// Bounds
//
// Every one of these exists to stop a run costing more than it is worth. A
// company with four conversations has nothing to learn from, and a model call
// per topic per week across the whole base is the part that shows up on a bill.
// ---------------------------------------------------------------------------

/** Below this many conversations in the period, a run is skipped outright. */
export const MIN_CONVERSATIONS_FOR_SUGGESTIONS = 25;

/**
 * A topic must appear in this many distinct conversations before it is worth a
 * flow. Distinct conversations, not messages: one person asking six times is
 * one person, and a "recurring question" that is really one confused customer
 * is exactly the false positive that makes an owner stop trusting the feature.
 */
export const MIN_CLUSTER_CONVERSATIONS = 5;

/** New drafts asked of the model per company per run. Each one is a model call. */
export const MAX_SUGGESTIONS_PER_RUN = 3;

/** Visitor messages read per run. Beyond this the extra rows change nothing. */
export const MAX_MESSAGES_SCANNED = 6000;

/** Clusters held at once — a hard ceiling on the O(n·clusters) comparison. */
const MAX_CLUSTERS = 400;

/** Similarity at which a message joins an existing intent. Matches the NLU threshold. */
export const INTENT_MATCH_THRESHOLD = 0.34;

/**
 * Similarity at which two messages are "the same question".
 *
 * Calibrated against the case this feature exists for: "do you deliver to
 * Karachi" and "do you deliver to Lahore" are one question with the place
 * swapped, and once the stopwords are gone they are two words sharing one — a
 * shade over 0.41 by the NLU's own measure. Anything stricter files every town
 * as its own topic and nothing ever reaches five conversations. Anything much
 * looser starts merging "delivery" with "returns".
 */
export const CLUSTER_THRESHOLD = 0.4;

/** Shortest and longest a message can be and still be a recurring question. */
const MIN_TOKENS = 2;
const MAX_TOKENS = 40;

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------
export interface VisitorMessage {
  conversationId: string;
  text: string;
}

/** An intent the company already defined, reused instead of clustering blind. */
export interface IntentSeed {
  name: string;
  examples: string[];
}

/** A question the assistant answered without confidence, for the second count. */
export interface LowConfidenceQuestion {
  question: string;
}

export interface QuestionCluster {
  /** Stable across runs: `intent:<name>` or `topic:<sorted keywords>`. */
  key: string;
  /** Set when this group came from one of the company's own intents. */
  intentName: string | null;
  /** The cluster's most common words, most frequent first. Deterministic. */
  keywords: string[];
  /** A real customer message from the middle of the group — a quote, not a summary. */
  representative: string;
  /** Verbatim examples, most typical first, one per conversation. */
  examples: string[];
  messageCount: number;
  conversationCount: number;
  /** Capped sample of the conversations counted, so the number can be checked. */
  conversationIds: string[];
  /** Answers on this topic the assistant was not confident about. Filled by `countLowConfidence`. */
  lowConfidenceCount: number;
}

interface WorkingCluster {
  key: string;
  intentName: string | null;
  /** Stemmed — what matching compares against. */
  seedTokens: string[];
  texts: string[];
  tokensPerMessage: string[][];
  /** The original words, for the keywords an owner reads. */
  wordsPerMessage: string[][];
  conversationIds: string[];
}

type Tokenize = (text: string) => string[];
type Similarity = (a: string[], b: string[]) => number;

/**
 * Fold a word to the form its neighbours share.
 *
 * "deliver", "delivery", "delivering" and "delivered" are one thing to the
 * person typing them, and to a matcher that compares whole words they are four.
 * Drop a plural, then keep the first five characters: it is not linguistics,
 * but it is deterministic, needs no dictionary, and works the same on the words
 * customers actually use — deliv, retur, charg, refun, book. Five rather than
 * four because four starts merging genuinely different words ("deli" would
 * cover deliver and delicate alike).
 *
 * Stems are used ONLY for deciding what groups with what. Everything an owner
 * reads — the keywords, the examples, the representative message — is the
 * original text, because "deliv" is not a word and nobody should be shown one.
 */
export function stemToken(token: string): string {
  const singular =
    token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
  return singular.length > 5 ? singular.slice(0, 5) : singular;
}

function stems(tokens: string[]): string[] {
  return tokens.map(stemToken);
}

/** Sort helper that never depends on input order, so two runs agree exactly. */
function byCountThenName(a: [string, number], b: [string, number]): number {
  return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/**
 * Group a company's own visitor messages into recurring questions.
 *
 * Existing `bot_intents` are consulted first: if the company already told us
 * "these phrases mean 'delivery'", a matching message joins that group and the
 * suggestion is named after the intent. Only what no intent claims is clustered
 * from scratch, by seeded single-link overlap — each cluster is compared against
 * the sentence that started it rather than a drifting centroid, which is what
 * keeps the output identical from one week to the next given the same messages.
 *
 * The inverted index is not a micro-optimisation: without it this is every
 * message against every cluster, and six thousand messages against four hundred
 * clusters is two and a half million set comparisons inside a weekly cron.
 */
export function clusterQuestions(
  messages: VisitorMessage[],
  intents: IntentSeed[],
  tokenize: Tokenize,
  similarity: Similarity,
): QuestionCluster[] {
  const intentTokens = intents.map((intent) => ({
    name: intent.name,
    examples: intent.examples.map((e) => stems(tokenize(e))).filter((t) => t.length > 0),
  }));

  const clusters: WorkingCluster[] = [];
  const byKey = new Map<string, number>();
  /** token -> indexes of free clusters whose seed contains it. */
  const index = new Map<string, number[]>();
  /** Exact repeats inside one conversation are one person, not two askings. */
  const seenInConversation = new Set<string>();

  for (const message of messages.slice(0, MAX_MESSAGES_SCANNED)) {
    const text = (message.text ?? '').trim();
    if (!text || text.length > 400) continue;

    const words = tokenize(text);
    if (words.length < MIN_TOKENS || words.length > MAX_TOKENS) continue;
    const tokens = stems(words);

    const repeatKey = `${message.conversationId}::${tokens.join(' ')}`;
    if (seenInConversation.has(repeatKey)) continue;
    seenInConversation.add(repeatKey);

    // --- does one of the company's own intents already claim this? ---------
    let bestIntent: { name: string; score: number } | null = null;
    for (const intent of intentTokens) {
      for (const example of intent.examples) {
        const score = similarity(tokens, example);
        if (!bestIntent || score > bestIntent.score) bestIntent = { name: intent.name, score };
      }
    }

    let target = -1;
    if (bestIntent && bestIntent.score >= INTENT_MATCH_THRESHOLD) {
      const key = `intent:${bestIntent.name}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        clusters.push({
          key,
          intentName: bestIntent.name,
          seedTokens: tokens,
          texts: [],
          tokensPerMessage: [],
          wordsPerMessage: [],
          conversationIds: [],
        });
        byKey.set(key, clusters.length - 1);
        target = clusters.length - 1;
      } else {
        target = existing;
      }
    } else {
      // --- otherwise, the nearest cluster that shares at least one word ----
      const candidates = new Set<number>();
      for (const token of new Set(tokens)) {
        for (const i of index.get(token) ?? []) candidates.add(i);
      }
      let best = -1;
      let bestScore = 0;
      for (const i of candidates) {
        const cluster = clusters[i];
        if (!cluster || cluster.intentName) continue;
        const score = similarity(tokens, cluster.seedTokens);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best >= 0 && bestScore >= CLUSTER_THRESHOLD) {
        target = best;
      } else if (clusters.length < MAX_CLUSTERS) {
        clusters.push({
          key: '',
          intentName: null,
          seedTokens: tokens,
          texts: [],
          tokensPerMessage: [],
          wordsPerMessage: [],
          conversationIds: [],
        });
        target = clusters.length - 1;
        for (const token of new Set(tokens)) {
          const list = index.get(token);
          if (list) list.push(target);
          else index.set(token, [target]);
        }
      } else {
        continue;
      }
    }

    const cluster = clusters[target];
    if (!cluster) continue;
    cluster.texts.push(text);
    cluster.tokensPerMessage.push(tokens);
    cluster.wordsPerMessage.push(words);
    cluster.conversationIds.push(message.conversationId);
  }

  return clusters
    .map((cluster) => finaliseCluster(cluster, similarity))
    .filter((c): c is QuestionCluster => c !== null)
    .sort((a, b) => b.conversationCount - a.conversationCount || (a.key < b.key ? -1 : 1));
}

/**
 * Turn a working cluster into the evidence a reviewer sees.
 *
 * Keywords are counted once per CONVERSATION rather than once per message, for
 * the same reason the insights topic list is — a customer who says "delivery"
 * nine times in one chat must not decide what the group is called.
 */
function finaliseCluster(cluster: WorkingCluster, similarity: Similarity): QuestionCluster | null {
  if (cluster.texts.length === 0) return null;

  const conversationIds = [...new Set(cluster.conversationIds)];

  // Counted over the ORIGINAL words, not the stems — a keyword an owner reads
  // has to be a word they would recognise.
  const perConversation = new Map<string, Set<string>>();
  cluster.wordsPerMessage.forEach((words, i) => {
    const conversationId = cluster.conversationIds[i] ?? '';
    const set = perConversation.get(conversationId) ?? new Set<string>();
    for (const word of words) set.add(word);
    perConversation.set(conversationId, set);
  });
  const termCounts = new Map<string, number>();
  for (const terms of perConversation.values()) {
    for (const term of terms) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }
  const keywords = [...termCounts.entries()].sort(byCountThenName).slice(0, 4).map(([term]) => term);
  if (keywords.length === 0) return null;

  // The most typical member: highest total similarity to the rest of the group,
  // capped at 30 comparisons because the shape of a cluster is clear long
  // before its four hundredth member. Ties break on the shorter sentence, then
  // alphabetically, so the pick never depends on row order.
  const sample = cluster.tokensPerMessage.slice(0, 30);
  let representative = cluster.texts[0] ?? '';
  let representativeTokens = cluster.tokensPerMessage[0] ?? [];
  let bestScore = -1;
  cluster.tokensPerMessage.forEach((tokens, i) => {
    if (i >= 30) return;
    let total = 0;
    for (const other of sample) total += similarity(tokens, other);
    const text = cluster.texts[i] ?? '';
    const better =
      total > bestScore ||
      (total === bestScore &&
        (text.length < representative.length ||
          (text.length === representative.length && text < representative)));
    if (better) {
      bestScore = total;
      representative = text;
      representativeTokens = tokens;
    }
  });

  // Examples are the evidence, so they have to earn their place: one per
  // conversation AND one per wording. Two different customers who typed the
  // identical sentence are two conversations — the count says so — but printing
  // that sentence twice under "in their own words" reads as a bug, not as
  // proof. Most typical first, measured against the representative.
  const seenConversations = new Set<string>();
  const seenWordings = new Set<string>();
  const examples: string[] = [];
  const ranked = cluster.texts
    .map((text, i) => ({
      text,
      conversationId: cluster.conversationIds[i] ?? '',
      score: similarity(cluster.tokensPerMessage[i] ?? [], representativeTokens),
    }))
    .sort((a, b) => b.score - a.score || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  for (const entry of ranked) {
    if (examples.length >= 6) break;
    if (seenConversations.has(entry.conversationId)) continue;
    const wording = entry.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenWordings.has(wording)) continue;
    seenConversations.add(entry.conversationId);
    seenWordings.add(wording);
    examples.push(entry.text.slice(0, 300));
  }

  // The key has to survive next week's run, or the same topic arrives as a
  // second suggestion. Two stems rather than three whole words: stems ignore
  // "delivery" overtaking "deliver" in the counts, and the third word is the
  // one most likely to change places as the window slides. It is not perfect —
  // a topic whose top two words genuinely change does come back once as a new
  // suggestion — but the alternative, keying on a single word, silently
  // suppresses two different topics that happen to share it.
  const key = cluster.key || `topic:${keywords.slice(0, 2).map(stemToken).sort().join('-')}`;

  return {
    key,
    intentName: cluster.intentName,
    keywords,
    representative: representative.slice(0, 300),
    examples,
    messageCount: cluster.texts.length,
    conversationCount: conversationIds.length,
    conversationIds: conversationIds.slice(0, 25),
    lowConfidenceCount: 0,
  };
}

/**
 * How many low-confidence answers landed on each topic.
 *
 * "The assistant was unsure twelve times" is the half of the pitch that says
 * why the flow is worth building, so like every other number here it is a count
 * of rows — the caller decides which quality logs count as unsure, and this
 * only decides which topic each one belongs to.
 */
export function countLowConfidence(
  clusters: QuestionCluster[],
  questions: LowConfidenceQuestion[],
  tokenize: Tokenize,
  similarity: Similarity,
): QuestionCluster[] {
  if (questions.length === 0) return clusters;

  const clusterTokens = clusters.map((c) => ({
    examples: [c.representative, ...c.examples]
      .map((t) => stems(tokenize(t)))
      .filter((t) => t.length > 0),
  }));
  const counts = new Array<number>(clusters.length).fill(0);

  for (const row of questions) {
    const words = tokenize(row.question ?? '');
    if (words.length < MIN_TOKENS) continue;
    const tokens = stems(words);
    let best = -1;
    let bestScore = 0;
    clusterTokens.forEach((cluster, i) => {
      for (const example of cluster.examples) {
        const score = similarity(tokens, example);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    });
    if (best >= 0 && bestScore >= CLUSTER_THRESHOLD) counts[best] = (counts[best] ?? 0) + 1;
  }

  return clusters.map((cluster, i) => ({ ...cluster, lowConfidenceCount: counts[i] ?? 0 }));
}

/** Stable id for "this same recurring question", so a run updates instead of duplicating. */
export function suggestionFingerprint(clusterKey: string): string {
  return `flow:${clusterKey}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200);
}

/** A short, readable topic built from the cluster's own words. Never a model's phrasing. */
export function topicLabel(cluster: QuestionCluster): string {
  return cluster.intentName ?? cluster.keywords.slice(0, 3).join(' ');
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The block types a suggestion may use.
 *
 * Everything omitted needs an identifier the model cannot possibly know or
 * performs an action outside the chat: `http` would post to a URL it invented,
 * `jump` names another flow's uuid, `assign` names an agent's uuid, `tag` and
 * `save_lead` write to the company's own records. A drafted flow that quietly
 * calls out to a made-up endpoint is not a draft, it is an incident.
 */
export const SUGGESTABLE_NODE_TYPES: FlowNodeType[] = [
  'start',
  'message',
  'ask',
  'buttons',
  'quick_replies',
  'condition',
  'ai',
  'handoff',
  'end',
];

const MAX_NODES = 24;
const MAX_EDGES = 40;
const MAX_CHOICES = 6;
const MAX_TEXT = 600;

export const SUGGESTION_SYSTEM_PROMPT = `You design a short guided chat (a "flow") for a small business's messaging assistant.

You will be given one question that the business's customers keep asking, with real examples of how they asked it. Write a flow that handles it properly.

THE FLOW FORMAT
A flow is a graph of blocks. Reply with JSON only, in exactly this shape:
{"name":"...","nodes":[{"id":"n1","type":"start","data":{}}],"edges":[{"source":"n1","target":"n2"}]}

Block types you may use, and nothing else:
- "start": where the conversation enters. Exactly one, and it must be the first block.
- "message": says something. data: {"text":"..."}
- "ask": asks an open question and stores the answer. data: {"text":"...","variable":"postcode","validation":"text"} — validation is one of text, email, phone, number, date, url.
- "buttons": asks a question with tappable options. data: {"text":"...","choices":[{"id":"c1","label":"..."}]}
- "quick_replies": the same, for short options.
- "condition": branches on an earlier answer. data: {"match":"all","conditions":[{"variable":"postcode","operator":"is_set"}]} — operators: equals, not_equals, contains, not_contains, starts_with, is_set, is_empty, greater_than, less_than. It has two outputs, "true" and "false".
- "ai": hands this turn to the assistant, which answers from the business's own knowledge base. data: {"instruction":"..."}
- "handoff": passes the conversation to a person. data: {"text":"..."}
- "end": finishes. data: {"text":"..."}

WIRING
- Every block except "start" must be reachable from "start" by following edges.
- An edge from "buttons" or "quick_replies" carries the id of the choice it belongs to: {"source":"b1","sourceHandle":"c1","target":"m2"}. Add one edge per choice, plus optionally a "fallback" edge for an answer that matches nothing.
- An edge from "condition" carries "true" or "false" as its sourceHandle.
- Every other edge needs no sourceHandle.

THE RULES THAT MATTER
1. You do not know this business. You do not know its prices, delivery areas, opening hours, stock or policies. NEVER state one. Where the answer depends on a fact only the business knows, collect what you need with "ask" or "buttons" and then use an "ai" block — it answers from the business's own knowledge base — or "handoff" to a person.
2. Never write a statistic, a count, a percentage or a claim about how many people asked anything. Not in a message, not in the name.
3. Keep it short: 5 to 10 blocks. A flow an owner cannot read in ten seconds gets deleted.
4. Write like the business talking to a customer — plain, warm, no jargon, no emoji spam.
5. Match the language the customers used in the examples.
6. Every path must end at an "end", a "handoff", or an "ai" block. No dead ends.
7. "name" is a short label for the owner's flow list, at most 60 characters.

Reply with the JSON object and nothing else.`;

/**
 * The user turn: what customers asked, in their own words.
 *
 * Deliberately carries NO totals. The model has no use for "47 conversations"
 * when writing a flow, and a model that has been shown a number is a model that
 * can repeat it back into a message an owner would then read as fact.
 */
export function buildSuggestionPrompt(cluster: QuestionCluster): string {
  const lines = [
    cluster.intentName
      ? `Customers keep asking about "${cluster.intentName}". Here is how they put it, in their own words:`
      : 'Customers keep asking the same thing. Here is how they put it, in their own words:',
    '',
    ...cluster.examples.map((example, i) => `${i + 1}. ${example}`),
  ];
  if (!cluster.examples.includes(cluster.representative)) {
    lines.push(`${cluster.examples.length + 1}. ${cluster.representative}`);
  }
  lines.push('', `The words they use most: ${cluster.keywords.join(', ')}.`);
  lines.push('Write the flow that answers this properly.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Deciding what the model is allowed to have written
// ---------------------------------------------------------------------------

const VOLUME_NOUNS =
  'people|customers|users|visitors|clients|shoppers|others|conversations|chats|messages|enquiries|inquiries|questions|times';
const CLAIM_VERBS =
  'asked|ask|asking|wanted|want|requested|contacted|messaged|said|reported|complained|enquired|inquired|raised|mentioned|needed|received|guessed|answered|replied|handled|escalated';

/**
 * Text that states a statistic.
 *
 * The prompt already forbids this, but "the prompt says not to" is not a
 * guarantee, and the one thing this feature cannot afford is a made-up number
 * appearing in an owner's own chat. A number next to a volume word AND a claim
 * verb is a claim; "table for 2 people" is not, and a flow that says it still
 * gets through.
 */
const STATISTIC_CLAIM = new RegExp(
  [
    // No trailing \b on the `%` branch: `%` is not a word character, so a
    // boundary after it never matches and "30% of chats" slipped straight past.
    String.raw`\b\d[\d,.]*\s*%`,
    String.raw`\b\d[\d,.]*\s*(?:percent|per cent)\b`,
    String.raw`\b\d[\d,.]*\s+(?:${VOLUME_NOUNS})\b(?:\s+\w+){0,2}\s+(?:${CLAIM_VERBS})\b`,
    String.raw`\b(?:${CLAIM_VERBS})\b(?:\s+\w+){0,2}\s+\d[\d,.]*\s+(?:${VOLUME_NOUNS})\b`,
    String.raw`\b\d[\d,.]*\s+(?:of|out of)\s+\d`,
  ].join('|'),
  'i',
);

export function statesAStatistic(text: string): boolean {
  return STATISTIC_CLAIM.test(text);
}

const NODE_TYPE_SET = new Set<string>(FLOW_NODE_TYPES);
const SUGGESTABLE = new Set<string>(SUGGESTABLE_NODE_TYPES);
const VALIDATIONS = new Set<AskValidation>(['text', 'email', 'phone', 'number', 'date', 'url']);
const OPERATORS = new Set<ConditionOperator>([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'is_set',
  'is_empty',
  'greater_than',
  'less_than',
]);

const ID_PREFIX: Partial<Record<FlowNodeType, string>> = {
  start: 'start',
  message: 'msg',
  ask: 'ask',
  buttons: 'btn',
  quick_replies: 'qr',
  condition: 'if',
  ai: 'ai',
  handoff: 'human',
  end: 'end',
};

interface RawNode {
  id?: unknown;
  type?: unknown;
  data?: unknown;
}
interface RawEdge {
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
}

export interface SanitisedSuggestion {
  name: string;
  graph: FlowGraph;
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A variable name the engine can actually look up: lowercase, underscores only. */
function slugVariable(value: unknown, fallback: string): string {
  const slug = text(value, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

/**
 * Accept the model's flow, or refuse it.
 *
 * What survives is structure and wording. What does not: identifiers,
 * geometry, choice ids and anything claiming a statistic. Ids are renumbered
 * from the block type so the builder reads sensibly, positions are computed
 * from the graph's own shape, and choice ids are ours with the model's edges
 * remapped onto them — a model that repeats a choice id twice would otherwise
 * produce two paths the engine cannot tell apart, which is a rule
 * `validateGraph` enforces and this avoids ever hitting.
 *
 * Returns `null` when the reply is not a flow at all. Semantic problems — an
 * unreachable block, a condition with no clauses — are left to `validateGraph`
 * in the caller, which is the same gate publishing uses.
 */
export function sanitiseSuggestedFlow(raw: unknown): SanitisedSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { name?: unknown; nodes?: unknown; edges?: unknown };
  if (!Array.isArray(body.nodes) || body.nodes.length === 0) return null;
  if (body.nodes.length > MAX_NODES) return null;

  const rawEdges = Array.isArray(body.edges) ? body.edges : [];
  if (rawEdges.length > MAX_EDGES) return null;

  const name = text(body.name, 60) || 'Suggested guided chat';
  if (statesAStatistic(name)) return null;

  // --- nodes ---------------------------------------------------------------
  const idMap = new Map<string, string>();
  /** Per node: the model's own choice id or label, lowercased -> our choice id. */
  const choiceMap = new Map<string, Map<string, string>>();
  const takenIds = new Set<string>();
  const askVariables = new Set<string>();
  const nodes: FlowNode[] = [];

  for (const entry of body.nodes as RawNode[]) {
    if (!entry || typeof entry !== 'object') return null;
    const type = text(entry.type, 30) as FlowNodeType;
    if (!NODE_TYPE_SET.has(type) || !SUGGESTABLE.has(type)) return null;

    const modelId = text(entry.id, 60);
    if (!modelId || idMap.has(modelId)) return null;

    const prefix = ID_PREFIX[type] ?? 'node';
    let n = 1;
    let id = `${prefix}_${n}`;
    while (takenIds.has(id)) id = `${prefix}_${++n}`;
    takenIds.add(id);
    idMap.set(modelId, id);

    const rawData = (entry.data && typeof entry.data === 'object' ? entry.data : {}) as Record<
      string,
      unknown
    >;
    const data: FlowNodeData = {};

    if (type === 'ai') {
      data.instruction = text(rawData.instruction) || text(rawData.text);
    } else if (type === 'start') {
      data.label = text(rawData.label, 60) || 'Conversation starts';
    } else {
      data.text = text(rawData.text);
    }

    if (type === 'ask') {
      const variable = slugVariable(rawData.variable, `answer_${nodes.length + 1}`);
      data.variable = askVariables.has(variable) ? `${variable}_${nodes.length + 1}` : variable;
      askVariables.add(data.variable);
      const validation = text(rawData.validation, 20) as AskValidation;
      data.validation = VALIDATIONS.has(validation) ? validation : 'text';
      const retry = text(rawData.retryText, 200);
      if (retry) data.retryText = retry;
      data.maxRetries = 2;
    }

    if (type === 'buttons' || type === 'quick_replies') {
      const rawChoices = Array.isArray(rawData.choices) ? rawData.choices : [];
      const choices: FlowChoice[] = [];
      const localMap = new Map<string, string>();
      for (const rawChoice of rawChoices.slice(0, MAX_CHOICES)) {
        const choice = (rawChoice ?? {}) as { id?: unknown; label?: unknown; value?: unknown };
        const label = text(choice.label, 60) || text(choice.value, 60);
        if (!label) continue;
        const ourId = `c${choices.length + 1}`;
        choices.push({ id: ourId, label });
        // Both handles the model might have used on its edges point here.
        const theirId = text(choice.id, 60).toLowerCase();
        if (theirId && !localMap.has(theirId)) localMap.set(theirId, ourId);
        const labelKey = label.toLowerCase();
        if (!localMap.has(labelKey)) localMap.set(labelKey, ourId);
      }
      data.choices = choices;
      choiceMap.set(id, localMap);
    }

    if (type === 'condition') {
      const rawConditions = Array.isArray(rawData.conditions) ? rawData.conditions : [];
      const conditions: NonNullable<FlowNodeData['conditions']> = [];
      for (const rawClause of rawConditions.slice(0, 6)) {
        const clause = (rawClause ?? {}) as { variable?: unknown; operator?: unknown; value?: unknown };
        const variable = slugVariable(clause.variable, '');
        const operator = text(clause.operator, 20) as ConditionOperator;
        if (!variable || !OPERATORS.has(operator)) continue;
        const value = text(clause.value, 120);
        conditions.push(value ? { variable, operator, value } : { variable, operator });
      }
      data.conditions = conditions;
      data.match = rawData.match === 'any' ? 'any' : 'all';
    }

    for (const value of [data.text, data.instruction, data.label, data.retryText]) {
      if (value && statesAStatistic(value)) return null;
    }
    for (const choice of data.choices ?? []) {
      if (statesAStatistic(choice.label)) return null;
    }

    nodes.push({ id, type, position: { x: 0, y: 0 }, data });
  }

  // --- edges ---------------------------------------------------------------
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: FlowEdge[] = [];
  const seenEdges = new Set<string>();

  for (const entry of rawEdges as RawEdge[]) {
    if (!entry || typeof entry !== 'object') continue;
    const source = idMap.get(text(entry.source, 60));
    const target = idMap.get(text(entry.target, 60));
    if (!source || !target || source === target) continue;

    const sourceNode = byId.get(source);
    const rawHandle = text(entry.sourceHandle, 60).toLowerCase();
    let handle = 'default';

    if (sourceNode?.type === 'buttons' || sourceNode?.type === 'quick_replies') {
      if (rawHandle === 'fallback' || rawHandle === 'else' || rawHandle === 'other') {
        handle = 'fallback';
      } else {
        const mapped = choiceMap.get(source)?.get(rawHandle);
        // An edge naming a choice that does not exist is dropped rather than
        // guessed at — a wrong branch is worse than a missing one, and the
        // reachability rule will reject the graph if it mattered.
        if (!mapped) continue;
        handle = mapped;
      }
    } else if (sourceNode?.type === 'condition') {
      handle = rawHandle === 'false' || rawHandle === 'no' ? 'false' : 'true';
    }

    const key = `${source}:${handle}`;
    // One edge per output. A second is the model contradicting itself.
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ id: `${source}:${handle}->${target}`, source, sourceHandle: handle, target });
  }

  stripUnknownPlaceholders(nodes, askVariables);
  layout(nodes, edges);

  return { name, graph: { nodes, edges } };
}

/**
 * Blank out `{{variable}}` references nothing will ever fill.
 *
 * `interpolate` in the engine leaves an unknown name blank, so a model that
 * opens with "Hi {{customer_name}}," ships a flow that greets everybody with
 * "Hi ,". Only variables an `ask` block actually collects survive.
 */
function stripUnknownPlaceholders(nodes: FlowNode[], known: Set<string>): void {
  const clean = (value: string): string =>
    value
      .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) =>
        known.has(name) ? match : '',
      )
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .trim();

  for (const node of nodes) {
    if (node.data.text) node.data.text = clean(node.data.text);
    if (node.data.retryText) node.data.retryText = clean(node.data.retryText);
    if (node.data.instruction) node.data.instruction = clean(node.data.instruction);
    if (node.data.choices) {
      node.data.choices = node.data.choices.map((c) => ({ ...c, label: clean(c.label) || c.label }));
    }
  }
}

const COL = 300;
const ROW = 150;

/**
 * Place the blocks on the canvas.
 *
 * Geometry is arithmetic, so the model is never asked for it: a breadth-first
 * walk from the entry block puts each block one column right of whatever leads
 * to it, and stacks siblings down the column. The result is a readable left-to-
 * right diagram in the existing builder without the model having any idea what
 * a pixel is. Blocks nothing reaches are parked in a final column, where
 * `validateGraph` will point at them.
 */
function layout(nodes: FlowNode[], edges: FlowEdge[]): void {
  const start = nodes.find((n) => n.type === 'start') ?? nodes[0];
  const depth = new Map<string, number>();
  if (start) {
    depth.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const current = queue.shift();
      if (current === undefined) break;
      const currentDepth = depth.get(current) ?? 0;
      for (const edge of edges) {
        if (edge.source !== current || depth.has(edge.target)) continue;
        depth.set(edge.target, currentDepth + 1);
        queue.push(edge.target);
      }
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  const rowsUsed = new Map<number, number>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? maxDepth + 1;
    const row = rowsUsed.get(column) ?? 0;
    rowsUsed.set(column, row + 1);
    node.position = { x: 60 + column * COL, y: 60 + row * ROW };
  }
}
