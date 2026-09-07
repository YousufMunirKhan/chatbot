import { createSupabaseServiceClient } from '@/lib/db/server';
import { CHANNEL_LABELS, labelFor, humanizeToken } from '@/lib/constants';
import { getCompanyId } from './data';
import {
  average,
  buildFunnel,
  buildHourHeatmap,
  containmentRate,
  firstContactResolution,
  groupQuestions,
  median,
  percentage,
  splitVisitors,
  topTopics,
  type FcrResult,
  type FunnelStage,
  type HourHeatmap,
  type TopicCount,
  type VisitorSplit,
} from './reports-metrics';

export interface ChannelReportRow {
  channel: string;
  label: string;
  conversations: number;
  messages: number;
  aiHandled: number;
  escalated: number;
  leads: number;
  /** Share of this channel's conversations that never needed a human. */
  automationRate: number;
}

export interface ReportTotals {
  conversations: number;
  messages: number;
  leads: number;
  escalated: number;
  automationRate: number;
  csatAverage: number | null;
  csatResponses: number;
}

export interface ReportsSnapshot {
  days: number;
  since: string;
  totals: ReportTotals;
  channels: ChannelReportRow[];
  daily: Array<{ date: string; conversations: number; messages: number }>;
  flows: Array<{ flowId: string; name: string; starts: number; completions: number; completionRate: number }>;
  heatmap: HourHeatmap;
  fcr: FcrResult;
}

/** A conversation that reached a human at any point. */
const ESCALATED_STATUSES = new Set(['needs_human', 'human_active']);

/** Conversations that are still someone's problem right now. */
const OPEN_STATUSES = ['ai_active', 'needs_human', 'human_active'];

/**
 * Read caps. Every list query on this page is bounded, because a report must
 * degrade into "the busiest N rows" rather than into a timeout: a chatty tenant
 * on a 90-day range would otherwise stream hundreds of thousands of rows into a
 * server component that renders a dozen numbers.
 */
const LIMITS = {
  conversations: 10000,
  messages: 20000,
  leads: 10000,
  ratings: 10000,
  flowEvents: 20000,
  slaEvents: 10000,
  orders: 5000,
  carts: 5000,
  appointments: 5000,
  qualityLogs: 2000,
  /** Text-bearing rows are capped harder — these carry message bodies. */
  visitorText: 5000,
  broadcasts: 500,
  automationRuns: 10000,
  rules: 200,
  members: 500,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function sinceIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Rows come back from PostgREST untyped; narrow once at the boundary. */
function rows<T>(res: { data: unknown }): T[] {
  return (res.data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Shared conversation/message shapes
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  channel: string | null;
  status: string | null;
  started_at: string;
  visitor_id?: string | null;
  assigned_agent_id?: string | null;
}

interface MessageRow {
  conversation_id: string;
  channel?: string | null;
  sender_type: string;
  sender_id?: string | null;
  created_at: string;
}

/** Conversation ids that a human agent actually touched. */
function humanTouchedIds(conversations: ConversationRow[], messages: MessageRow[]): Set<string> {
  const touched = new Set<string>();
  for (const c of conversations) if (ESCALATED_STATUSES.has(c.status ?? '')) touched.add(c.id);
  for (const m of messages) if (m.sender_type === 'agent') touched.add(m.conversation_id);
  return touched;
}

// ===========================================================================
// 1. Overview
// ===========================================================================

/**
 * Channel-level reporting for the last `days` days.
 *
 * Aggregation is done in memory over bounded page reads rather than with one
 * grouped SQL statement per metric: PostgREST cannot express GROUP BY without a
 * database function, and a handful of round trips of at most a few thousand
 * narrow rows is both faster and simpler than that many RPCs to maintain.
 */
export async function getReportsSnapshot(days = 30): Promise<ReportsSnapshot> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = sinceIso(days);

  const [convoRes, messageRes, leadRes, csatRes, flowEventRes, flowRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,channel,status,started_at,visitor_id')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(LIMITS.conversations),
    // `conversation_id` and `sender_type` ride along on the existing read so
    // first-contact resolution and the AI/human split cost no extra round trip.
    sb
      .from('messages')
      .select('conversation_id,channel,sender_type,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.messages),
    sb
      .from('leads')
      .select('conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.leads),
    sb
      .from('conversation_ratings')
      .select('rating,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.ratings),
    sb
      .from('flow_node_events')
      .select('flow_id,event,conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.flowEvents),
    sb.from('flows').select('id,name').eq('company_id', companyId).limit(LIMITS.rules),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const leads = rows<{ conversation_id: string | null }>(leadRes);

  const channelOf = new Map<string, string>();
  for (const c of conversations) channelOf.set(c.id, c.channel ?? 'web_chat');

  const stats = new Map<string, ChannelReportRow>();
  const row = (channel: string): ChannelReportRow => {
    const existing = stats.get(channel);
    if (existing) return existing;
    const created: ChannelReportRow = {
      channel,
      label: CHANNEL_LABELS[channel] ?? channel,
      conversations: 0,
      messages: 0,
      aiHandled: 0,
      escalated: 0,
      leads: 0,
      automationRate: 0,
    };
    stats.set(channel, created);
    return created;
  };

  for (const c of conversations) {
    const entry = row(c.channel ?? 'web_chat');
    entry.conversations += 1;
    if (ESCALATED_STATUSES.has(c.status ?? '')) entry.escalated += 1;
    else entry.aiHandled += 1;
  }
  for (const m of messages) row(m.channel ?? 'web_chat').messages += 1;
  for (const l of leads) {
    const channel = l.conversation_id ? channelOf.get(l.conversation_id) : undefined;
    row(channel ?? 'web_chat').leads += 1;
  }

  const channels = [...stats.values()]
    .map((c) => ({
      ...c,
      automationRate: percentage(c.aiHandled, c.conversations),
    }))
    .sort((a, b) => b.conversations - a.conversations);

  // Daily series — one bucket per day so the chart has no gaps.
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dayKeys.push(new Date(Date.now() - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  const dailyMap = new Map(dayKeys.map((d) => [d, { date: d, conversations: 0, messages: 0 }]));
  for (const c of conversations) {
    const bucket = dailyMap.get(c.started_at.slice(0, 10));
    if (bucket) bucket.conversations += 1;
  }
  for (const m of messages) {
    const bucket = dailyMap.get(m.created_at.slice(0, 10));
    if (bucket) bucket.messages += 1;
  }

  const ratings = rows<{ rating: number | null }>(csatRes)
    .map((r) => r.rating)
    .filter((r): r is number => typeof r === 'number');

  const flowNames = new Map(rows<{ id: string; name: string }>(flowRes).map((f) => [f.id, f.name]));
  // A "start" is one conversation entering the flow, not one block being
  // entered. Counting `entered` events directly divided completions by the
  // number of blocks people walked through, so a longer flow always looked
  // worse and the rate could never reach 100%.
  const flowStats = new Map<string, { starts: Set<string>; completions: Set<string> }>();
  for (const e of rows<{ flow_id: string; event: string; conversation_id: string | null }>(flowEventRes)) {
    const entry = flowStats.get(e.flow_id) ?? { starts: new Set<string>(), completions: new Set<string>() };
    // Events from a deleted conversation keep their own identity so they are
    // still counted once each rather than collapsing into one.
    const key = e.conversation_id ?? `anon:${entry.starts.size}:${e.event}`;
    if (e.event === 'entered') entry.starts.add(key);
    if (e.event === 'completed') entry.completions.add(key);
    flowStats.set(e.flow_id, entry);
  }

  const totalConversations = conversations.length;
  const totalEscalated = channels.reduce((sum, c) => sum + c.escalated, 0);

  return {
    days,
    since,
    totals: {
      conversations: totalConversations,
      messages: messages.length,
      leads: leads.length,
      escalated: totalEscalated,
      automationRate: containmentRate(totalConversations, totalEscalated),
      csatAverage: average(ratings),
      csatResponses: ratings.length,
    },
    channels,
    daily: [...dailyMap.values()],
    flows: [...flowStats.entries()]
      .map(([flowId, s]) => {
        const starts = s.starts.size;
        const completions = s.completions.size;
        return {
          flowId,
          name: flowNames.get(flowId) ?? 'Deleted flow',
          starts,
          completions,
          // Capped: a conversation can complete a flow it entered in an earlier
          // period, which would otherwise read as over 100%.
          completionRate: starts === 0 ? 0 : Math.min(100, percentage(completions, starts)),
        };
      })
      .sort((a, b) => b.starts - a.starts)
      .slice(0, 10),
    heatmap: buildHourHeatmap(conversations.map((c) => c.started_at)),
    fcr: firstContactResolution(
      conversations.map((c) => ({
        id: c.id,
        visitorId: c.visitor_id ?? null,
        startedAt: c.started_at,
        status: c.status,
      })),
      humanTouchedIds(conversations, messages),
    ),
  };
}

// ===========================================================================
// 2. Team
// ===========================================================================

export interface AgentReportRow {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  conversations: number;
  messagesSent: number;
  /** Median minutes to the first agent reply, or null when never measured. */
  medianFirstResponseMinutes: number | null;
  firstResponseSamples: number;
  csatAverage: number | null;
  csatResponses: number;
  openLoad: number;
}

export interface TeamReport {
  days: number;
  agents: AgentReportRow[];
  totals: {
    agentsActive: number;
    conversationsHandled: number;
    messagesSent: number;
    medianFirstResponseMinutes: number | null;
    unassignedOpen: number;
  };
  /** True when at least one figure came from the SLA clock rather than the fallback. */
  slaEventsUsed: boolean;
}

/**
 * Per-agent performance.
 *
 * First response is read from `sla_events` where it exists and reconstructed
 * from the message timeline where it does not. That fallback is not a nicety:
 * `sla_states` is only created for conversations covered by an active SLA
 * policy, so a company that never configured one would otherwise see a blank
 * column and conclude the report is broken rather than that the clock is off.
 */
export async function getTeamReport(days = 30): Promise<TeamReport> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = sinceIso(days);

  const [convoRes, messageRes, ratingRes, slaRes, memberRes, openRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,channel,status,started_at,assigned_agent_id')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(LIMITS.conversations),
    sb
      .from('messages')
      .select('conversation_id,sender_type,sender_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.messages),
    sb
      .from('conversation_ratings')
      .select('conversation_id,rating')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.ratings),
    sb
      .from('sla_events')
      .select('conversation_id,event,minutes,created_at')
      .eq('company_id', companyId)
      .eq('event', 'responded')
      .gte('created_at', since)
      .limit(LIMITS.slaEvents),
    sb.from('company_users').select('user_id,role').eq('company_id', companyId).limit(LIMITS.members),
    // Open load is "right now", not "in the window", so it is deliberately not
    // date-filtered — a manager reassigning work cares about the current queue.
    sb
      .from('conversations')
      .select('assigned_agent_id,status')
      .eq('company_id', companyId)
      .in('status', OPEN_STATUSES)
      .limit(LIMITS.conversations),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const members = rows<{ user_id: string; role: string }>(memberRes);

  // The ONE query on this page with no `company_id` filter, because `users` is
  // the global identity table and has no such column. It is still tenant-safe:
  // the id list comes from `company_users` filtered to this company above, so
  // this can only ever resolve names for people already proven to be members.
  // It is a second round trip rather than a PostgREST embed so the filter stays
  // visible here instead of hiding inside a relationship hint.
  const userIds = members.map((m) => m.user_id);
  const userRes = userIds.length
    ? await sb.from('users').select('id,email,full_name').in('id', userIds).limit(LIMITS.members)
    : { data: [] };
  const profiles = new Map(
    rows<{ id: string; email: string | null; full_name: string | null }>(userRes).map((u) => [u.id, u]),
  );

  // --- per-conversation timeline ------------------------------------------
  const firstVisitorAt = new Map<string, number>();
  const firstAgentAt = new Map<string, number>();
  const firstAgentBy = new Map<string, string>();
  const messagesByAgent = new Map<string, number>();
  const convosByAgent = new Map<string, Set<string>>();

  const touch = (agentId: string): Set<string> => {
    const existing = convosByAgent.get(agentId);
    if (existing) return existing;
    const created = new Set<string>();
    convosByAgent.set(agentId, created);
    return created;
  };

  for (const m of messages) {
    const at = new Date(m.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (m.sender_type === 'visitor') {
      const current = firstVisitorAt.get(m.conversation_id);
      if (current === undefined || at < current) firstVisitorAt.set(m.conversation_id, at);
      continue;
    }
    if (m.sender_type !== 'agent') continue;
    const agentId = m.sender_id ?? null;
    if (agentId) {
      messagesByAgent.set(agentId, (messagesByAgent.get(agentId) ?? 0) + 1);
      touch(agentId).add(m.conversation_id);
    }
    const current = firstAgentAt.get(m.conversation_id);
    if (current === undefined || at < current) {
      firstAgentAt.set(m.conversation_id, at);
      if (agentId) firstAgentBy.set(m.conversation_id, agentId);
    }
  }

  // An assignment counts as handling even with no reply yet, so a conversation
  // sitting unanswered in someone's queue still shows up against their name.
  for (const c of conversations) if (c.assigned_agent_id) touch(c.assigned_agent_id).add(c.id);

  // --- first response times ------------------------------------------------
  const slaMinutes = new Map<string, number>();
  for (const e of rows<{ conversation_id: string | null; minutes: number | null }>(slaRes)) {
    if (!e.conversation_id || e.minutes === null || e.minutes === undefined) continue;
    const current = slaMinutes.get(e.conversation_id);
    if (current === undefined || e.minutes < current) slaMinutes.set(e.conversation_id, e.minutes);
  }

  const responseByAgent = new Map<string, number[]>();
  const allResponses: number[] = [];
  for (const conversationId of new Set([...firstAgentAt.keys(), ...slaMinutes.keys()])) {
    const fromSla = slaMinutes.get(conversationId);
    let minutes: number | null = fromSla ?? null;
    if (minutes === null) {
      const askedAt = firstVisitorAt.get(conversationId);
      const repliedAt = firstAgentAt.get(conversationId);
      if (askedAt !== undefined && repliedAt !== undefined && repliedAt >= askedAt) {
        minutes = (repliedAt - askedAt) / 60_000;
      }
    }
    if (minutes === null || minutes < 0) continue;
    allResponses.push(minutes);
    const agentId = firstAgentBy.get(conversationId);
    if (!agentId) continue;
    const list = responseByAgent.get(agentId);
    if (list) list.push(minutes);
    else responseByAgent.set(agentId, [minutes]);
  }

  // --- CSAT per agent -------------------------------------------------------
  const ratingByConversation = new Map<string, number>();
  for (const r of rows<{ conversation_id: string; rating: number | null }>(ratingRes)) {
    if (typeof r.rating === 'number') ratingByConversation.set(r.conversation_id, r.rating);
  }

  // --- open load ------------------------------------------------------------
  const openByAgent = new Map<string, number>();
  let unassignedOpen = 0;
  for (const c of rows<{ assigned_agent_id: string | null }>(openRes)) {
    if (!c.assigned_agent_id) unassignedOpen += 1;
    else openByAgent.set(c.assigned_agent_id, (openByAgent.get(c.assigned_agent_id) ?? 0) + 1);
  }

  const agents: AgentReportRow[] = members
    .map((member) => {
      const profile = profiles.get(member.user_id);
      const handled = convosByAgent.get(member.user_id) ?? new Set<string>();
      const ratings = [...handled]
        .map((id) => ratingByConversation.get(id))
        .filter((r): r is number => typeof r === 'number');
      const responses = responseByAgent.get(member.user_id) ?? [];
      return {
        userId: member.user_id,
        name: profile?.full_name || profile?.email || 'Removed teammate',
        email: profile?.email ?? null,
        role: humanizeToken(member.role),
        conversations: handled.size,
        messagesSent: messagesByAgent.get(member.user_id) ?? 0,
        medianFirstResponseMinutes: median(responses),
        firstResponseSamples: responses.length,
        csatAverage: average(ratings),
        csatResponses: ratings.length,
        openLoad: openByAgent.get(member.user_id) ?? 0,
      };
    })
    .sort((a, b) => b.conversations - a.conversations || b.messagesSent - a.messagesSent);

  return {
    days,
    agents,
    totals: {
      agentsActive: agents.filter((a) => a.conversations > 0 || a.messagesSent > 0).length,
      conversationsHandled: new Set([...convosByAgent.values()].flatMap((s) => [...s])).size,
      messagesSent: [...messagesByAgent.values()].reduce((a, b) => a + b, 0),
      medianFirstResponseMinutes: median(allResponses),
      unassignedOpen,
    },
    slaEventsUsed: slaMinutes.size > 0,
  };
}

// ===========================================================================
// 3. Customers
// ===========================================================================

export interface CustomerRow {
  key: string;
  name: string;
  contact: string | null;
  orders: number;
  value: number;
  currency: string;
  /** True when the totals mix currencies and were therefore not converted. */
  mixedCurrency: boolean;
}

export interface CustomersReport {
  days: number;
  funnel: FunnelStage[];
  visitors: VisitorSplit;
  leadsByStatus: Array<{ status: string; label: string; count: number }>;
  topCustomers: CustomerRow[];
  appointments: {
    booked: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
    completionRate: number;
  };
  /** No store connected, so the customer table can only see chat orders. */
  storeOrdersPresent: boolean;
}

const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  converted: 'Converted',
  closed: 'Closed',
};

/** Qualified is cumulative — a converted lead was qualified on its way there. */
const QUALIFIED_STATUSES = new Set(['qualified', 'converted']);

interface OrderLike {
  name: string | null;
  email: string | null;
  phone: string | null;
  total: number;
  currency: string;
  status: string | null;
}

function rankCustomers(orders: OrderLike[], limit = 10): CustomerRow[] {
  const byCustomer = new Map<string, CustomerRow & { currencies: Set<string> }>();
  for (const order of orders) {
    const contact = (order.email || order.phone || '').trim().toLowerCase();
    const key = contact || (order.name || '').trim().toLowerCase();
    if (!key) continue;
    const existing = byCustomer.get(key);
    if (existing) {
      existing.orders += 1;
      existing.value += order.total;
      existing.currencies.add(order.currency);
      if (!existing.name && order.name) existing.name = order.name;
    } else {
      byCustomer.set(key, {
        key,
        name: order.name || order.email || order.phone || 'Unnamed customer',
        contact: order.email || order.phone || null,
        orders: 1,
        value: order.total,
        currency: order.currency,
        currencies: new Set([order.currency]),
        mixedCurrency: false,
      });
    }
  }
  return [...byCustomer.values()]
    .map(({ currencies, ...row }) => ({ ...row, mixedCurrency: currencies.size > 1 }))
    .sort((a, b) => b.value - a.value || b.orders - a.orders)
    .slice(0, limit);
}

/** Lead funnel, repeat visitors, best customers and booking follow-through. */
export async function getCustomersReport(days = 30): Promise<CustomersReport> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = sinceIso(days);

  const [convoRes, leadRes, apptRes, chatOrderRes, storeOrderRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,visitor_id,started_at')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(LIMITS.conversations),
    sb
      .from('leads')
      .select('id,status,conversation_id,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.leads),
    sb
      .from('appointments')
      .select('id,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.appointments),
    sb
      .from('chat_orders')
      .select('id,customer_name,customer_email,customer_phone,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.orders),
    sb
      .from('synced_orders')
      .select('id,customer_name,customer_email,customer_phone,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.orders),
  ]);

  const conversations = rows<{ visitor_id: string | null }>(convoRes);
  const leads = rows<{ status: string | null }>(leadRes);
  const appointments = rows<{ status: string | null }>(apptRes);

  const statusCounts = new Map<string, number>();
  for (const l of leads) {
    const status = l.status ?? 'new';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const qualified = leads.filter((l) => QUALIFIED_STATUSES.has(l.status ?? '')).length;
  const converted = leads.filter((l) => l.status === 'converted').length;

  const apptCount = (status: string) => appointments.filter((a) => a.status === status).length;
  const completed = apptCount('completed');

  type OrderRow = {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    total: unknown;
    currency: string | null;
    status: string | null;
  };
  const toOrderLike = (o: OrderRow): OrderLike => ({
    name: o.customer_name,
    email: o.customer_email,
    phone: o.customer_phone,
    total: num(o.total),
    currency: o.currency ?? 'USD',
    status: o.status,
  });
  const storeOrders = rows<OrderRow>(storeOrderRes);
  const allOrders = [...rows<OrderRow>(chatOrderRes), ...storeOrders]
    .map(toOrderLike)
    .filter((o) => o.status !== 'cancelled');

  return {
    days,
    funnel: buildFunnel([
      {
        key: 'conversations',
        label: 'Conversations',
        count: conversations.length,
        hint: 'Every chat started in this period.',
      },
      { key: 'leads', label: 'Leads captured', count: leads.length, hint: 'Contact details collected.' },
      { key: 'qualified', label: 'Qualified', count: qualified, hint: 'Marked qualified or converted.' },
      { key: 'converted', label: 'Converted', count: converted, hint: 'Marked converted.' },
    ]),
    visitors: splitVisitors(conversations.map((c) => c.visitor_id)),
    leadsByStatus: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, label: labelFor(LEAD_STATUS_LABELS, status), count }))
      .sort((a, b) => b.count - a.count),
    topCustomers: rankCustomers(allOrders),
    appointments: {
      booked: appointments.length,
      confirmed: apptCount('confirmed'),
      completed,
      cancelled: apptCount('cancelled'),
      noShow: apptCount('no_show'),
      completionRate: percentage(completed, appointments.length),
    },
    storeOrdersPresent: storeOrders.length > 0,
  };
}

// ===========================================================================
// 4. Assistant
// ===========================================================================

export interface AssistantReport {
  days: number;
  conversations: number;
  containedConversations: number;
  containmentRate: number;
  averageMessagesToResolution: number | null;
  resolvedConversations: number;
  csat: {
    aiOnly: { average: number | null; responses: number };
    humanTouched: { average: number | null; responses: number };
  };
  unanswered: Array<{ question: string; count: number }>;
  unansweredTotal: number;
  /** False when the AI quality log has no rows at all for this period. */
  qualityLoggingActive: boolean;
  topics: TopicCount[];
  topicSampleSize: number;
}

/**
 * Bot performance.
 *
 * "Unanswered" comes from `answer_quality_logs.failure_reason`, which the chat
 * engine already writes, rather than from re-matching a phrase against reply
 * text. The engine's own `inferFailureReason` decides what "the assistant did
 * not know" means; re-implementing that guess here would produce a second,
 * quietly different definition of the same metric — and it would break the
 * moment the fallback wording is reworded or translated.
 */
export async function getAssistantReport(days = 30): Promise<AssistantReport> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = sinceIso(days);

  const [convoRes, messageRes, ratingRes, qualityRes, qualityAnyRes, visitorTextRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id,status,started_at')
      .eq('company_id', companyId)
      .gte('started_at', since)
      .limit(LIMITS.conversations),
    sb
      .from('messages')
      .select('conversation_id,sender_type,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.messages),
    sb
      .from('conversation_ratings')
      .select('conversation_id,rating')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.ratings),
    sb
      .from('answer_quality_logs')
      .select('question,failure_reason,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .in('failure_reason', ['missing_info', 'weak_retrieval'])
      .order('created_at', { ascending: false })
      .limit(LIMITS.qualityLogs),
    // One cheap probe so an empty list can say "logging is off" instead of
    // "the assistant answered everything".
    sb
      .from('answer_quality_logs')
      .select('id')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(1),
    // Message bodies are the heaviest rows on this page, so the topic sample is
    // capped well below the other reads and takes the most recent slice.
    sb
      .from('messages')
      .select('content_text,created_at')
      .eq('company_id', companyId)
      .eq('sender_type', 'visitor')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(LIMITS.visitorText),
  ]);

  const conversations = rows<ConversationRow>(convoRes);
  const messages = rows<MessageRow>(messageRes);
  const touched = humanTouchedIds(conversations, messages);

  const messageCounts = new Map<string, number>();
  for (const m of messages) messageCounts.set(m.conversation_id, (messageCounts.get(m.conversation_id) ?? 0) + 1);

  const resolved = conversations.filter((c) => c.status === 'closed');
  const resolutionLengths = resolved.map((c) => messageCounts.get(c.id) ?? 0).filter((n) => n > 0);

  const aiOnly: number[] = [];
  const withHuman: number[] = [];
  for (const r of rows<{ conversation_id: string; rating: number | null }>(ratingRes)) {
    if (typeof r.rating !== 'number') continue;
    if (touched.has(r.conversation_id)) withHuman.push(r.rating);
    else aiOnly.push(r.rating);
  }

  const quality = rows<{ question: string | null }>(qualityRes);
  const visitorTexts = rows<{ content_text: string | null }>(visitorTextRes).map((m) => m.content_text);

  return {
    days,
    conversations: conversations.length,
    containedConversations: conversations.length - touched.size,
    containmentRate: containmentRate(conversations.length, touched.size),
    averageMessagesToResolution: average(resolutionLengths),
    resolvedConversations: resolved.length,
    csat: {
      aiOnly: { average: average(aiOnly), responses: aiOnly.length },
      humanTouched: { average: average(withHuman), responses: withHuman.length },
    },
    unanswered: groupQuestions(quality.map((q) => q.question)),
    unansweredTotal: quality.length,
    qualityLoggingActive: rows<{ id: string }>(qualityAnyRes).length > 0,
    topics: topTopics(visitorTexts),
    topicSampleSize: visitorTexts.filter(Boolean).length,
  };
}

// ===========================================================================
// 5. Sales & campaigns
// ===========================================================================

export interface SalesReport {
  days: number;
  orders: {
    total: number;
    fromChat: number;
    chatAttributionRate: number;
    storeSynced: number;
  };
  revenueByCurrency: Array<{ currency: string; total: number; paid: number; orders: number }>;
  carts: {
    created: number;
    abandoned: number;
    recoveryMessaged: number;
    recovered: number;
    recoveryRate: number;
    /** No active `cart_abandoned` rule means the detector never runs. */
    detectorActive: boolean;
  };
  broadcasts: {
    campaigns: number;
    recipients: number;
    failed: number;
    byChannel: Array<{ channel: string; label: string; campaigns: number; recipients: number; failed: number }>;
    recent: Array<{ id: string; channel: string; label: string; status: string; sent: number; sentAt: string | null; subject: string | null }>;
  };
  automations: Array<{
    ruleId: string;
    name: string;
    trigger: string;
    channel: string;
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    successRate: number;
  }>;
  automationRunsTotal: number;
}

const PAID_ORDER_STATUSES = new Set(['paid', 'fulfilled']);

/** Chat-attributed orders, cart recovery, broadcasts and automation outcomes. */
export async function getSalesReport(days = 30): Promise<SalesReport> {
  const companyId = await getCompanyId();
  const sb = createSupabaseServiceClient();
  const since = sinceIso(days);

  const [chatOrderRes, storeOrderRes, cartRes, broadcastRes, runRes, ruleRes, abandonRuleRes] = await Promise.all([
    sb
      .from('chat_orders')
      .select('id,conversation_id,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.orders),
    sb
      .from('synced_orders')
      .select('id,total,currency,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.orders),
    sb
      .from('chat_carts')
      .select('id,status,subtotal,currency,abandoned_at,recovered_at,recovery_sent_at,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.carts),
    sb
      .from('broadcasts')
      .select('id,channel,status,sent_count,subject,created_at,sent_at,error')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(LIMITS.broadcasts),
    sb
      .from('automation_runs')
      .select('rule_id,status,created_at')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(LIMITS.automationRuns),
    sb
      .from('automation_rules')
      .select('id,name,trigger_event,channel')
      .eq('company_id', companyId)
      .limit(LIMITS.rules),
    sb
      .from('automation_rules')
      .select('id')
      .eq('company_id', companyId)
      .eq('trigger_event', 'cart_abandoned')
      .eq('is_active', true)
      .limit(1),
  ]);

  interface ChatOrder {
    conversation_id: string | null;
    total: unknown;
    currency: string | null;
    status: string | null;
  }
  const chatOrders = rows<ChatOrder>(chatOrderRes);
  const storeOrders = rows<{ total: unknown; currency: string | null; status: string | null }>(storeOrderRes);

  const money = new Map<string, { currency: string; total: number; paid: number; orders: number }>();
  const addMoney = (currency: string | null, total: unknown, status: string | null) => {
    if (status === 'cancelled') return;
    const key = currency ?? 'USD';
    const entry = money.get(key) ?? { currency: key, total: 0, paid: 0, orders: 0 };
    const value = num(total);
    entry.total += value;
    entry.orders += 1;
    if (PAID_ORDER_STATUSES.has(status ?? '')) entry.paid += value;
    money.set(key, entry);
  };
  for (const o of chatOrders) addMoney(o.currency, o.total, o.status);
  for (const o of storeOrders) addMoney(o.currency, o.total, o.status);

  const fromChat = chatOrders.filter((o) => Boolean(o.conversation_id)).length;
  const totalOrders = chatOrders.length + storeOrders.length;

  const carts = rows<{
    status: string | null;
    abandoned_at: string | null;
    recovered_at: string | null;
    recovery_sent_at: string | null;
  }>(cartRes);
  const abandoned = carts.filter((c) => Boolean(c.abandoned_at)).length;
  const recovered = carts.filter((c) => Boolean(c.recovered_at)).length;

  const broadcasts = rows<{
    id: string;
    channel: string;
    status: string;
    sent_count: number | null;
    subject: string | null;
    sent_at: string | null;
  }>(broadcastRes);

  const channelStats = new Map<string, { channel: string; label: string; campaigns: number; recipients: number; failed: number }>();
  for (const b of broadcasts) {
    const entry = channelStats.get(b.channel) ?? {
      channel: b.channel,
      label: labelFor(CHANNEL_LABELS, b.channel),
      campaigns: 0,
      recipients: 0,
      failed: 0,
    };
    entry.campaigns += 1;
    entry.recipients += num(b.sent_count);
    if (b.status === 'failed') entry.failed += 1;
    channelStats.set(b.channel, entry);
  }

  const ruleInfo = new Map(
    rows<{ id: string; name: string; trigger_event: string; channel: string }>(ruleRes).map((r) => [r.id, r]),
  );
  const runStats = new Map<string, { sent: number; pending: number; failed: number; skipped: number }>();
  const runs = rows<{ rule_id: string; status: string }>(runRes);
  for (const run of runs) {
    const entry = runStats.get(run.rule_id) ?? { sent: 0, pending: 0, failed: 0, skipped: 0 };
    if (run.status === 'sent') entry.sent += 1;
    else if (run.status === 'failed') entry.failed += 1;
    else if (run.status === 'skipped') entry.skipped += 1;
    else entry.pending += 1;
    runStats.set(run.rule_id, entry);
  }

  return {
    days,
    orders: {
      total: totalOrders,
      fromChat,
      chatAttributionRate: percentage(fromChat, totalOrders),
      storeSynced: storeOrders.length,
    },
    revenueByCurrency: [...money.values()]
      .map((m) => ({ ...m, total: Math.round(m.total * 100) / 100, paid: Math.round(m.paid * 100) / 100 }))
      .sort((a, b) => b.total - a.total),
    carts: {
      created: carts.length,
      abandoned,
      recoveryMessaged: carts.filter((c) => Boolean(c.recovery_sent_at)).length,
      recovered,
      recoveryRate: percentage(recovered, abandoned),
      detectorActive: rows<{ id: string }>(abandonRuleRes).length > 0,
    },
    broadcasts: {
      campaigns: broadcasts.length,
      recipients: broadcasts.reduce((sum, b) => sum + num(b.sent_count), 0),
      failed: broadcasts.filter((b) => b.status === 'failed').length,
      byChannel: [...channelStats.values()].sort((a, b) => b.recipients - a.recipients),
      recent: broadcasts.slice(0, 10).map((b) => ({
        id: b.id,
        channel: b.channel,
        label: labelFor(CHANNEL_LABELS, b.channel),
        status: humanizeToken(b.status),
        sent: num(b.sent_count),
        sentAt: b.sent_at,
        subject: b.subject,
      })),
    },
    automations: [...runStats.entries()]
      .map(([ruleId, s]) => {
        const rule = ruleInfo.get(ruleId);
        const attempted = s.sent + s.failed;
        return {
          ruleId,
          name: rule?.name || 'Deleted rule',
          trigger: humanizeToken(rule?.trigger_event ?? 'unknown'),
          channel: labelFor(CHANNEL_LABELS, rule?.channel),
          sent: s.sent,
          pending: s.pending,
          failed: s.failed,
          skipped: s.skipped,
          successRate: percentage(s.sent, attempted),
        };
      })
      .sort((a, b) => b.sent + b.failed - (a.sent + a.failed))
      .slice(0, 20),
    automationRunsTotal: runs.length,
  };
}
