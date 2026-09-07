import { fingerprint, type Evidence } from './evidence';

export type InsightCategory =
  | 'knowledge_gap'
  | 'answer_quality'
  | 'response_time'
  | 'channel'
  | 'flow'
  | 'sales'
  | 'consent'
  | 'other';

export type InsightSeverity = 'critical' | 'warning' | 'info';

export interface Finding {
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  detail: string;
  recommendation?: string;
  evidence: Record<string, unknown>;
  actionHref?: string;
  actionLabel?: string;
  fingerprint: string;
}

/**
 * Findings that are pure arithmetic.
 *
 * These never involve a model. A number is either over a threshold or it is
 * not, and an owner acting on "your CSAT fell 1.3 points on WhatsApp" deserves
 * to know that claim came from counting, not from a language model's
 * impression. The model layer only handles the part that genuinely needs
 * language: reading what customers actually asked.
 */

const CHANNEL_NAMES: Record<string, string> = {
  web_chat: 'the website chat',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  telegram: 'Telegram',
  viber: 'Viber',
  line: 'LINE',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  email: 'email',
};

function channelName(key: string): string {
  return CHANNEL_NAMES[key] ?? key;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

export function deterministicFindings(evidence: Evidence): Finding[] {
  const findings: Finding[] = [];
  const t = evidence.totals;
  const days = evidence.periodDays;

  // --- satisfaction ---------------------------------------------------------
  if (t.csatAverage !== null && t.csatPreviousAverage !== null && t.csatSample >= 10) {
    const drop = Math.round((t.csatPreviousAverage - t.csatAverage) * 10) / 10;
    if (drop >= 0.5) {
      findings.push({
        category: 'answer_quality',
        severity: drop >= 1 ? 'critical' : 'warning',
        title: `Customer satisfaction fell ${drop} points`,
        detail: `Ratings averaged ${t.csatAverage} out of 5 in the last ${days} days, down from ${t.csatPreviousAverage} in the ${days} days before. Based on ${t.csatSample} ratings.`,
        recommendation:
          'Open the conversations rated 1 or 2 in the inbox and look for the question that keeps going wrong, then add the answer to your business info.',
        evidence: {
          metric: 'csat',
          before: t.csatPreviousAverage,
          after: t.csatAverage,
          sample: t.csatSample,
        },
        actionHref: '/company/reports',
        actionLabel: 'See ratings',
        fingerprint: fingerprint('answer_quality', 'csat-drop'),
      });
    }
  }

  if (t.csatAverage !== null && t.csatSample >= 10 && t.csatAverage < 3) {
    findings.push({
      category: 'answer_quality',
      severity: 'critical',
      title: `Customers are rating conversations ${t.csatAverage} out of 5`,
      detail: `Across ${t.csatSample} ratings in the last ${days} days. Anything under 3 means most people left unhappy.`,
      recommendation: 'Read the lowest-rated conversations first — they usually share one missing answer.',
      evidence: { metric: 'csat', value: t.csatAverage, sample: t.csatSample },
      actionHref: '/company/inbox',
      actionLabel: 'Open the inbox',
      fingerprint: fingerprint('answer_quality', 'csat-low'),
    });
  }

  // --- reply speed ----------------------------------------------------------
  if (t.slaTracked >= 10) {
    const breachRate = pct(t.slaBreached, t.slaTracked);
    if (breachRate >= 20) {
      findings.push({
        category: 'response_time',
        severity: breachRate >= 50 ? 'critical' : 'warning',
        title: `${breachRate}% of conversations missed your reply-time target`,
        detail: `${t.slaBreached} of ${t.slaTracked} conversations that needed a person went past the target in the last ${days} days.`,
        recommendation:
          breachRate >= 50
            ? 'Either the target is tighter than your team can meet, or nobody is watching the inbox at the times these arrive. Check the busiest hours before loosening the target.'
            : 'Turn on the warning that fires a few minutes before the deadline so someone can still get there in time.',
        evidence: { metric: 'sla_breach_rate', value: breachRate, breached: t.slaBreached, tracked: t.slaTracked },
        actionHref: '/company/sla',
        actionLabel: 'Review targets',
        fingerprint: fingerprint('response_time', 'breach-rate'),
      });
    }
  }

  // --- how much the assistant handles alone ---------------------------------
  if (t.conversations >= 30 && t.containmentRate < 50) {
    findings.push({
      category: 'knowledge_gap',
      severity: 'warning',
      title: `Your team is being pulled into ${100 - t.containmentRate}% of conversations`,
      detail: `${t.escalated} of ${t.conversations} conversations in the last ${days} days needed a person. The assistant is answering fewer than half on its own.`,
      recommendation:
        'This is almost always missing information rather than a broken assistant. Add your delivery areas, prices, opening hours and returns policy to your business info.',
      evidence: { metric: 'containment', value: t.containmentRate, escalated: t.escalated, total: t.conversations },
      actionHref: '/company/business-data',
      actionLabel: 'Add business info',
      fingerprint: fingerprint('knowledge_gap', 'low-containment'),
    });
  }

  // --- per channel ----------------------------------------------------------
  for (const channel of evidence.channels) {
    if (channel.csatSample >= 8 && channel.csatAverage !== null && channel.csatAverage < 3.5) {
      findings.push({
        category: 'channel',
        severity: 'warning',
        title: `${channelName(channel.channel)} is rated lower than your other channels`,
        detail: `${channel.csatAverage} out of 5 across ${channel.csatSample} ratings, from ${channel.conversations} conversations.`,
        recommendation:
          'Check that this channel can actually send what the assistant tries to send — buttons, images and links behave differently on each platform.',
        evidence: {
          metric: 'csat_by_channel',
          channel: channel.channel,
          value: channel.csatAverage,
          sample: channel.csatSample,
        },
        actionHref: '/company/channels',
        actionLabel: 'Check the channel',
        fingerprint: fingerprint('channel', `csat-${channel.channel}`),
      });
    }

    if (channel.conversations >= 20 && pct(channel.escalated, channel.conversations) >= 70) {
      findings.push({
        category: 'channel',
        severity: 'info',
        title: `Nearly every ${channelName(channel.channel)} conversation reaches a person`,
        detail: `${channel.escalated} of ${channel.conversations} conversations were escalated.`,
        recommendation:
          'Either the assistant is missing something specific to this channel, or the people who use it expect a human. Read ten of them before changing anything.',
        evidence: {
          metric: 'escalation_by_channel',
          channel: channel.channel,
          escalated: channel.escalated,
          total: channel.conversations,
        },
        actionHref: '/company/inbox',
        actionLabel: 'Read the conversations',
        fingerprint: fingerprint('channel', `escalation-${channel.channel}`),
      });
    }
  }

  // --- flows ----------------------------------------------------------------
  for (const drop of evidence.flowDropOff) {
    if (drop.dropRate < 50) continue;
    findings.push({
      category: 'flow',
      severity: drop.dropRate >= 75 ? 'warning' : 'info',
      title: `${drop.dropRate}% of people stop at one question in "${drop.name}"`,
      detail: `${drop.entered} people reached that step and ${drop.continued} answered it.`,
      recommendation:
        'A question people skip is usually one they cannot answer yet, or one that feels too personal for that point in the chat. Try moving it later or making it optional.',
      evidence: {
        metric: 'flow_drop_off',
        flowId: drop.flowId,
        nodeId: drop.nodeId,
        nodeType: drop.nodeType,
        entered: drop.entered,
        continued: drop.continued,
      },
      actionHref: `/company/flows/${drop.flowId}`,
      actionLabel: 'Open the flow',
      fingerprint: fingerprint('flow', `${drop.flowId}-${drop.nodeId}`),
    });
  }

  // --- volume ---------------------------------------------------------------
  if (t.conversations >= 20 && t.conversationsPrevious >= 20) {
    const change = Math.round(((t.conversations - t.conversationsPrevious) / t.conversationsPrevious) * 100);
    if (Math.abs(change) >= 40) {
      findings.push({
        category: 'other',
        severity: 'info',
        title:
          change > 0
            ? `Conversations are up ${change}% on the previous ${days} days`
            : `Conversations are down ${Math.abs(change)}% on the previous ${days} days`,
        detail: `${t.conversations} conversations, against ${t.conversationsPrevious} in the period before.`,
        recommendation:
          change > 0
            ? 'Check your reply-time figures still hold at this volume before it becomes a complaint.'
            : 'Worth checking that every channel is still connected — a quiet week and a broken webhook look identical from here.',
        evidence: { metric: 'volume', current: t.conversations, previous: t.conversationsPrevious, change },
        actionHref: '/company/reports',
        actionLabel: 'See the trend',
        fingerprint: fingerprint('other', 'volume-change'),
      });
    }
  }

  return findings;
}

/** Findings the model returns, before they are trusted. */
export interface ModelFinding {
  title?: string;
  detail?: string;
  recommendation?: string;
  category?: string;
  severity?: string;
  examples?: string[];
}

const CATEGORIES: InsightCategory[] = [
  'knowledge_gap',
  'answer_quality',
  'response_time',
  'channel',
  'flow',
  'sales',
  'consent',
  'other',
];

/**
 * Accept only what the model is actually qualified to produce: wording,
 * grouping and a recommendation. Severity is capped at `warning` and every
 * numeric claim is left to the deterministic pass, so a hallucinated statistic
 * cannot reach the owner as fact.
 */
export function sanitiseModelFindings(raw: unknown, evidenceSample: string[]): Finding[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { findings?: unknown })?.findings) ? (raw as { findings: unknown[] }).findings : [];
  const out: Finding[] = [];

  for (const item of list.slice(0, 6)) {
    const f = (item ?? {}) as ModelFinding;
    const title = String(f.title ?? '').trim();
    const detail = String(f.detail ?? '').trim();
    if (!title || !detail) continue;

    const category = CATEGORIES.includes(f.category as InsightCategory)
      ? (f.category as InsightCategory)
      : 'knowledge_gap';
    // Only the arithmetic pass may raise something to critical.
    const severity: InsightSeverity = f.severity === 'warning' ? 'warning' : 'info';

    // Examples must come from the questions we actually supplied.
    const allowed = new Set(evidenceSample.map((s) => s.trim().toLowerCase()));
    const examples = (Array.isArray(f.examples) ? f.examples : [])
      .map((e) => String(e ?? '').trim())
      .filter((e) => e && allowed.has(e.toLowerCase()))
      .slice(0, 5);

    out.push({
      category,
      severity,
      title: title.slice(0, 140),
      detail: detail.slice(0, 700),
      recommendation: f.recommendation ? String(f.recommendation).slice(0, 400) : undefined,
      evidence: { source: 'model', examples },
      actionHref: category === 'knowledge_gap' ? '/company/business-data' : undefined,
      actionLabel: category === 'knowledge_gap' ? 'Add the answer' : undefined,
      fingerprint: fingerprint(category, title.toLowerCase().slice(0, 60)),
    });
  }
  return out;
}

/** Drop duplicates, keeping the more severe copy of the same fingerprint. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const rank: Record<InsightSeverity, number> = { critical: 3, warning: 2, info: 1 };
  const best = new Map<string, Finding>();
  for (const f of findings) {
    const existing = best.get(f.fingerprint);
    if (!existing || rank[f.severity] > rank[existing.severity]) best.set(f.fingerprint, f);
  }
  return [...best.values()].sort((a, b) => rank[b.severity] - rank[a.severity]);
}
