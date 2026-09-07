/**
 * The evidence pack an insights run reasons over.
 *
 * Assembling it is deliberately separate from the model call: it is pure
 * arithmetic over rows, so it can be tested exactly, and the model only ever
 * sees numbers we computed rather than being asked to count things itself —
 * which is the failure mode that makes AI analytics untrustworthy.
 */

export interface ConversationRow {
  id: string;
  channel: string | null;
  status: string | null;
  started_at: string;
}

export interface MessageRow {
  conversation_id: string;
  sender_type: string;
  content_text: string | null;
  created_at: string;
}

export interface RatingRow {
  rating: number | null;
  channel: string | null;
  created_at: string;
}

export interface FlowEventRow {
  flow_id: string;
  node_id: string;
  node_type: string | null;
  event: string;
  conversation_id: string | null;
}

export interface SlaStateRow {
  first_response_at: string | null;
  first_response_breached: boolean;
  resolution_breached: boolean;
}

export interface EvidenceInput {
  periodDays: number;
  now: Date;
  conversations: ConversationRow[];
  messages: MessageRow[];
  ratings: RatingRow[];
  flowEvents: FlowEventRow[];
  slaStates: SlaStateRow[];
  flowNames: Map<string, string>;
  /** Visitor questions the assistant could not answer, most recent first. */
  unanswered: string[];
}

export interface ChannelSlice {
  channel: string;
  conversations: number;
  escalated: number;
  csatAverage: number | null;
  csatSample: number;
}

export interface Evidence {
  periodDays: number;
  totals: {
    conversations: number;
    conversationsPrevious: number;
    messages: number;
    escalated: number;
    containmentRate: number;
    csatAverage: number | null;
    csatSample: number;
    csatPreviousAverage: number | null;
    slaTracked: number;
    slaBreached: number;
  };
  channels: ChannelSlice[];
  /** Words customers used most, with the count of conversations they appear in. */
  topics: Array<{ term: string; conversations: number }>;
  unanswered: string[];
  flowDropOff: Array<{
    flowId: string;
    name: string;
    nodeId: string;
    nodeType: string | null;
    entered: number;
    continued: number;
    dropRate: number;
  }>;
  /** True when there is too little data for any finding to be meaningful. */
  thin: boolean;
}

const ESCALATED = new Set(['needs_human', 'human_active']);

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/**
 * Below this, differences are noise. A company with nine conversations does not
 * need to be told its CSAT moved.
 */
export const MIN_CONVERSATIONS_FOR_INSIGHTS = 15;

export function buildEvidence(input: EvidenceInput, tokenize: (text: string) => string[]): Evidence {
  const { conversations, messages, ratings, flowEvents, slaStates, periodDays, now } = input;

  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - periodDays * 2 * 24 * 60 * 60 * 1000);

  const current = conversations.filter((c) => new Date(c.started_at) >= periodStart);
  const previous = conversations.filter((c) => {
    const at = new Date(c.started_at);
    return at >= previousStart && at < periodStart;
  });

  const escalated = current.filter((c) => ESCALATED.has(c.status ?? '')).length;

  const currentRatings = ratings.filter((r) => new Date(r.created_at) >= periodStart);
  const previousRatings = ratings.filter((r) => {
    const at = new Date(r.created_at);
    return at >= previousStart && at < periodStart;
  });
  const ratingValues = (rows: RatingRow[]) =>
    rows.map((r) => r.rating).filter((r): r is number => typeof r === 'number');

  // --- per channel ---------------------------------------------------------
  const byChannel = new Map<string, { conversations: number; escalated: number; ratings: number[] }>();
  const slice = (channel: string) => {
    const existing = byChannel.get(channel);
    if (existing) return existing;
    const created = { conversations: 0, escalated: 0, ratings: [] as number[] };
    byChannel.set(channel, created);
    return created;
  };
  for (const c of current) {
    const s = slice(c.channel ?? 'web_chat');
    s.conversations += 1;
    if (ESCALATED.has(c.status ?? '')) s.escalated += 1;
  }
  for (const r of currentRatings) {
    if (typeof r.rating === 'number') slice(r.channel ?? 'web_chat').ratings.push(r.rating);
  }

  const channels: ChannelSlice[] = [...byChannel.entries()]
    .map(([channel, s]) => ({
      channel,
      conversations: s.conversations,
      escalated: s.escalated,
      csatAverage: average(s.ratings),
      csatSample: s.ratings.length,
    }))
    .sort((a, b) => b.conversations - a.conversations);

  // --- what customers talked about -----------------------------------------
  // Counted per conversation, not per message, so one chatty customer repeating
  // a word twelve times does not become a "top topic".
  const currentIds = new Set(current.map((c) => c.id));
  const termConversations = new Map<string, Set<string>>();
  for (const m of messages) {
    if (m.sender_type !== 'visitor' || !m.content_text) continue;
    if (!currentIds.has(m.conversation_id)) continue;
    for (const term of new Set(tokenize(m.content_text))) {
      const set = termConversations.get(term) ?? new Set<string>();
      set.add(m.conversation_id);
      termConversations.set(term, set);
    }
  }
  const topics = [...termConversations.entries()]
    .map(([term, ids]) => ({ term, conversations: ids.size }))
    // A term seen in one conversation is an anecdote, not a topic.
    .filter((t) => t.conversations >= 3)
    .sort((a, b) => b.conversations - a.conversations)
    .slice(0, 15);

  // --- where flows lose people ---------------------------------------------
  const nodeEntered = new Map<string, { flowId: string; nodeId: string; nodeType: string | null; ids: Set<string> }>();
  const conversationsAnswered = new Map<string, Set<string>>();
  for (const e of flowEvents) {
    const key = `${e.flow_id}::${e.node_id}`;
    if (e.event === 'entered') {
      const entry =
        nodeEntered.get(key) ??
        { flowId: e.flow_id, nodeId: e.node_id, nodeType: e.node_type, ids: new Set<string>() };
      if (e.conversation_id) entry.ids.add(e.conversation_id);
      nodeEntered.set(key, entry);
    } else if (e.event === 'answered' && e.conversation_id) {
      const set = conversationsAnswered.get(key) ?? new Set<string>();
      set.add(e.conversation_id);
      conversationsAnswered.set(key, set);
    }
  }
  const flowDropOff = [...nodeEntered.entries()]
    .map(([key, entry]) => {
      const entered = entry.ids.size;
      const continued = conversationsAnswered.get(key)?.size ?? 0;
      return {
        flowId: entry.flowId,
        name: input.flowNames.get(entry.flowId) ?? 'Flow',
        nodeId: entry.nodeId,
        nodeType: entry.nodeType,
        entered,
        continued,
        dropRate: entered === 0 ? 0 : Math.round(((entered - continued) / entered) * 100),
      };
    })
    // Only question blocks can be "abandoned"; a message block is passed through.
    .filter((d) => d.entered >= 5 && ['ask', 'buttons', 'quick_replies', 'csat'].includes(d.nodeType ?? ''))
    .sort((a, b) => b.dropRate - a.dropRate)
    .slice(0, 5);

  const csatValues = ratingValues(currentRatings);

  return {
    periodDays,
    totals: {
      conversations: current.length,
      conversationsPrevious: previous.length,
      messages: messages.length,
      escalated,
      containmentRate: current.length === 0 ? 0 : Math.round(((current.length - escalated) / current.length) * 100),
      csatAverage: average(csatValues),
      csatSample: csatValues.length,
      csatPreviousAverage: average(ratingValues(previousRatings)),
      slaTracked: slaStates.length,
      slaBreached: slaStates.filter((s) => s.first_response_breached || s.resolution_breached).length,
    },
    channels,
    topics,
    unanswered: input.unanswered.slice(0, 25),
    flowDropOff,
    thin: current.length < MIN_CONVERSATIONS_FOR_INSIGHTS,
  };
}

/** A stable id for "this same finding", so a weekly run updates instead of duplicating. */
export function fingerprint(category: string, key: string): string {
  return `${category}:${key}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 200);
}
