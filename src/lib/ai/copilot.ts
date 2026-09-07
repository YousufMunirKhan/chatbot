import { createSupabaseServiceClient } from '@/lib/db/server';
import { AppError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getAiCreditAccess } from '@/lib/billing/credits';
import { isAiBudgetExceeded } from '@/lib/ai/cost-controls';
import { wrapUntrusted, INJECTION_GUARD } from '@/lib/ai/safety';
import { getCachedBusinessContext } from './business-context';
import { detectConversationLanguage } from './lang';
import { getChatProviderAsync } from './providers';
import { publicCitation, resolveCitations, retrieveContext, type Citation } from './rag';
import { logAiUsage } from './usage';
import { BOT_COLUMNS, describeBot, loadCompanyBots, type AssistantBot } from './preview';

/**
 * Agent copilot (inbox).
 *
 * Three jobs a human agent actually has in front of an open conversation:
 * draft a reply, catch up on a long thread, and reword something they already
 * typed. All three produce a DRAFT. Nothing here sends a message, changes a
 * conversation, or reaches the customer — the agent stays the author, and the
 * endpoint that wraps this returns text for a compose box, never a send.
 *
 * The project rule about model output applies here as it does to insights: the
 * model is trusted with wording and nothing else. The counts and times in a
 * summary are arithmetic done in this file and returned separately from the
 * prose, and a citation marker in a suggested reply is only allowed to point at
 * an excerpt that retrieval genuinely returned.
 */

export type CopilotMode = 'suggest_reply' | 'summarise' | 'rephrase';
export type CopilotTone = 'friendly' | 'formal' | 'concise' | 'apologetic';

/** Counted facts about the conversation. No model touches these. */
export interface CopilotFacts {
  channel: string;
  status: string;
  priority: string;
  tags: string[];
  totalMessages: number;
  visitorMessages: number;
  aiMessages: number;
  agentMessages: number;
  startedAt: string | null;
  lastMessageAt: string | null;
  /** Whole minutes between the first and last message. */
  durationMinutes: number | null;
  /** Whole minutes the last visitor message has been waiting for a reply. */
  waitingMinutes: number | null;
  csatRating: number | null;
  /** True when the transcript was trimmed to fit the model's window. */
  transcriptTruncated: boolean;
}

export interface CopilotResult {
  mode: CopilotMode;
  /** The draft. Always for a human to read, edit and decide to send. */
  text: string;
  citations: Array<ReturnType<typeof publicCitation>>;
  facts: CopilotFacts;
  language: 'ar' | 'en';
  provider: string;
  model: string;
  disclaimer: string;
}

// A long thread still has to fit a prompt. Newest turns win, because that is
// where the unanswered question is.
const MAX_TRANSCRIPT_MESSAGES = 80;
const MAX_TRANSCRIPT_CHARS = 12_000;

const MAX_DRAFT_CHARS = 1_500;
const MAX_SUMMARY_CHARS = 1_200;

const DISCLAIMER: Record<CopilotMode, string> = {
  suggest_reply:
    'Suggested draft. Check it against the sources before you send — nothing has been sent to the customer.',
  summarise:
    'Written summary. The counts and times shown alongside it are measured, not written by the model.',
  rephrase: 'Reworded draft. It should say what you said — check that it still does before you send.',
};

interface TranscriptTurn {
  senderType: string;
  text: string;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  bot_id: string | null;
  channel: string;
  status: string;
  priority: string;
  tags: string[] | null;
  language: string | null;
  started_at: string | null;
  last_message_at: string | null;
  summary: string | null;
}

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

/** How a transcript line is labelled for the model, and for the agent reading it. */
function speakerLabel(senderType: string): string {
  if (senderType === 'visitor') return 'Customer';
  if (senderType === 'agent') return 'Agent';
  if (senderType === 'ai') return 'Assistant';
  return 'System';
}

function formatTranscript(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${speakerLabel(t.senderType)}: ${t.text}`).join('\n');
}

/**
 * Drop any `[n]` marker the model wrote that does not name a retrieved excerpt.
 *
 * The direct counterpart of `sanitiseModelFindings` in the insights module: the
 * model is allowed to say which of the excerpts it was given supports a line,
 * and it is not allowed to conjure a source number the agent cannot open. A
 * marker pointing at nothing is worse than no marker, because it reads as
 * evidence.
 */
export function sanitiseCitationMarkers(
  text: string,
  citationCount: number,
): { text: string; cited: number[] } {
  const cited = new Set<number>();
  let removed = false;
  const cleaned = text.replace(/\[(\d{1,2})\]/g, (marker, digits: string) => {
    const n = Number(digits);
    if (n >= 1 && n <= citationCount) {
      cited.add(n);
      return marker;
    }
    removed = true;
    return '';
  });
  return {
    // Cutting a marker out of the middle of a sentence leaves a double space
    // behind it. Only tidy when something was actually cut, so a draft the
    // model indented on purpose keeps its shape.
    text: (removed ? cleaned.replace(/[ \t]{2,}/g, ' ') : cleaned).trim(),
    cited: [...cited].sort((a, b) => a - b),
  };
}

async function loadConversation(companyId: string, conversationId: string): Promise<ConversationRow> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('conversations')
    .select('id,bot_id,channel,status,priority,tags,language,started_at,last_message_at,summary')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();
  if (error) {
    logger.warn('Copilot could not load the conversation', { conversationId, error: error.message });
    throw new AppError('Could not load that conversation.', 500, 'conversation_read_failed');
  }
  if (!data) throw new NotFoundError('Conversation not found.');
  return data as ConversationRow;
}

async function loadTranscript(
  companyId: string,
  conversationId: string,
): Promise<{ turns: TranscriptTurn[]; charCapped: boolean }> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from('messages')
    .select('sender_type,content_text,created_at')
    .eq('company_id', companyId)
    .eq('conversation_id', conversationId)
    .in('sender_type', ['visitor', 'ai', 'agent'])
    .order('created_at', { ascending: false })
    .limit(MAX_TRANSCRIPT_MESSAGES);
  if (error) {
    logger.warn('Copilot could not load messages', { conversationId, error: error.message });
    throw new AppError('Could not load that conversation.', 500, 'messages_read_failed');
  }

  const newestFirst = (data ?? []) as Array<Record<string, unknown>>;
  const turns: TranscriptTurn[] = [];
  let chars = 0;
  let charCapped = false;
  for (const row of newestFirst) {
    const text = ((row.content_text as string) ?? '').trim();
    if (!text) continue;
    if (chars + text.length > MAX_TRANSCRIPT_CHARS && turns.length > 0) {
      charCapped = true;
      break;
    }
    chars += text.length;
    turns.push({
      senderType: (row.sender_type as string) ?? 'system',
      text,
      createdAt: (row.created_at as string) ?? '',
    });
  }
  turns.reverse();
  return { turns, charCapped };
}

// A conversation longer than this is not one anybody is counting by hand, and
// the sender breakdown stops being the interesting part well before here.
const MAX_COUNTED_MESSAGES = 5_000;

/**
 * The sender breakdown and the waiting time, counted over the WHOLE
 * conversation rather than the slice that fitted in the prompt.
 *
 * This is the point of separating facts from prose: an agent reading "4
 * messages from the customer" next to a forty-turn thread would be reading a
 * number that describes the prompt window, not their conversation.
 */
async function loadFacts(
  companyId: string,
  conversation: ConversationRow,
  charCapped: boolean,
  loadedTurns: number,
): Promise<CopilotFacts> {
  const sb = createSupabaseServiceClient();
  const [countRes, ratingRes] = await Promise.all([
    sb
      .from('messages')
      .select('sender_type,created_at')
      .eq('company_id', companyId)
      .eq('conversation_id', conversation.id)
      .in('sender_type', ['visitor', 'ai', 'agent'])
      .order('created_at', { ascending: true })
      .limit(MAX_COUNTED_MESSAGES),
    sb
      .from('conversation_ratings')
      .select('rating')
      .eq('company_id', companyId)
      .eq('conversation_id', conversation.id)
      .maybeSingle(),
  ]);

  const rows = (countRes.data ?? []) as Array<Record<string, unknown>>;
  let visitorMessages = 0;
  let aiMessages = 0;
  let agentMessages = 0;
  let lastVisitorAt: string | null = null;
  let lastReplyAt: string | null = null;
  for (const row of rows) {
    const sender = (row.sender_type as string) ?? '';
    const at = (row.created_at as string) ?? null;
    if (sender === 'visitor') {
      visitorMessages += 1;
      lastVisitorAt = at;
    } else {
      if (sender === 'ai') aiMessages += 1;
      if (sender === 'agent') agentMessages += 1;
      lastReplyAt = at;
    }
  }

  // Waiting time only means anything while the customer is the one who spoke
  // last; after a reply it would just be time since the conversation went quiet.
  const stillWaiting =
    lastVisitorAt !== null &&
    (lastReplyAt === null || new Date(lastReplyAt).getTime() < new Date(lastVisitorAt).getTime());

  return {
    channel: conversation.channel,
    status: conversation.status,
    priority: conversation.priority,
    tags: conversation.tags ?? [],
    totalMessages: rows.length,
    visitorMessages,
    aiMessages,
    agentMessages,
    startedAt: conversation.started_at,
    lastMessageAt: conversation.last_message_at,
    durationMinutes: minutesBetween(conversation.started_at, conversation.last_message_at),
    waitingMinutes: stillWaiting ? minutesBetween(lastVisitorAt, new Date().toISOString()) : null,
    csatRating: ratingRes.data ? Number((ratingRes.data as { rating: number }).rating) : null,
    transcriptTruncated: charCapped || rows.length > loadedTurns,
  };
}

async function resolveBot(companyId: string, botId: string | null): Promise<AssistantBot> {
  if (botId) {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('bots')
      .select(BOT_COLUMNS)
      .eq('company_id', companyId)
      .eq('id', botId)
      .maybeSingle();
    if (data) return describeBot(data as Record<string, unknown>);
  }
  // No bot on the conversation: prefer a customer-facing one. The bot decides
  // which audience retrieval may read, and guessing "internal" here would let
  // staff-only knowledge into a draft meant for a customer.
  const rows = await loadCompanyBots(companyId);
  const described = rows.map(describeBot);
  return described.find((b) => b.assistantAudience === 'customer') ?? described[0] ?? describeBot(null);
}

/**
 * Refuse before spending anything the company has already capped. The widget
 * does the same checks before a customer-facing reply; a copilot draft costs
 * the same tokens and comes out of the same budget.
 */
async function assertCanSpend(companyId: string): Promise<void> {
  const [budgetExceeded, credit] = await Promise.all([
    isAiBudgetExceeded(companyId),
    getAiCreditAccess(companyId),
  ]);
  if (budgetExceeded) {
    throw new AppError(
      'The monthly AI budget limit has been reached, so the copilot is paused.',
      402,
      'ai_budget_exceeded',
    );
  }
  if (!credit.allowed) {
    throw new AppError('This account has no AI credit left.', 402, 'ai_credit_exhausted');
  }
}

const TONE_INSTRUCTION: Record<CopilotTone, string> = {
  friendly: 'Warm and personable, but not chatty.',
  formal: 'Professional and precise. No contractions, no slang.',
  concise: 'As short as it can be while still answering. Cut every sentence that is not needed.',
  apologetic: 'Acknowledge the trouble the customer has had before answering. Do not grovel.',
};

/**
 * Run one copilot job for one conversation.
 *
 * `companyId` comes from the caller's session and every read below is filtered
 * by it, so an agent cannot pull a draft out of another tenant's conversation
 * by guessing an id — the service-role client would happily return it otherwise.
 */
export async function runCopilot(params: {
  companyId: string;
  conversationId: string;
  mode: CopilotMode;
  /** The agent's own words. Required for `rephrase`, optional steer elsewhere. */
  draft?: string;
  tone?: CopilotTone;
}): Promise<CopilotResult> {
  const draft = params.draft?.trim() ?? '';
  if (params.mode === 'rephrase' && !draft) {
    throw new AppError('Type something before asking for a rewording.', 400, 'draft_required');
  }

  const conversation = await loadConversation(params.companyId, params.conversationId);
  const { turns, charCapped } = await loadTranscript(params.companyId, conversation.id);
  if (turns.length === 0 && params.mode !== 'rephrase') {
    throw new AppError('There is nothing in this conversation to work from yet.', 400, 'empty_conversation');
  }

  const resolved = await getChatProviderAsync();
  // The mock provider returns canned text. An agent pasting a fabricated reply
  // to a customer is a worse outcome than an unavailable button.
  if (resolved.apiType === 'mock') {
    throw new AppError('No AI provider is configured, so the copilot is unavailable.', 503, 'ai_not_configured');
  }
  await assertCanSpend(params.companyId);

  const facts = await loadFacts(params.companyId, conversation, charCapped, turns.length);
  const bot = await resolveBot(params.companyId, conversation.bot_id);

  const visitorTexts = turns.filter((t) => t.senderType === 'visitor').map((t) => t.text);
  const lastVisitorText = visitorTexts[visitorTexts.length - 1] ?? '';
  const language = detectConversationLanguage(
    draft || lastVisitorText || turns[turns.length - 1]?.text || '',
    turns.map((t) => t.text),
  );
  const transcript = formatTranscript(turns);

  // Retrieval only earns its cost when the model is being asked to state facts
  // about the business. Rewording the agent's own sentence does not.
  let citations: Citation[] = [];
  let contextText = '';
  if (params.mode === 'suggest_reply') {
    // Retrieve against what the customer asked, not against what the agent has
    // half-typed — the question is the thing that needs an answer behind it.
    const query = lastVisitorText || draft;
    if (query) {
      const retrieved = await retrieveContext(
        params.companyId,
        bot.id,
        query,
        6,
        undefined,
        bot.assistantAudience,
        language,
      );
      contextText = retrieved.contextText;
      if (retrieved.chunks.length > 0) {
        citations = await resolveCitations(params.companyId, retrieved.chunks).catch(() => []);
      }
    }
  }

  const businessContext = params.mode === 'rephrase' ? '' : await getCachedBusinessContext(params.companyId);

  const { system, user, maxTokens } = buildPrompt({
    mode: params.mode,
    language,
    tone: params.tone,
    draft,
    transcript,
    contextText,
    businessContext,
    citationCount: citations.length,
    priorSummary: conversation.summary,
  });

  let raw = '';
  try {
    const completion = await resolved.provider.complete({
      model: resolved.model,
      temperature: params.mode === 'rephrase' ? 0.2 : 0.4,
      maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    raw = completion.text ?? '';
    await logAiUsage({
      companyId: params.companyId,
      botId: bot.id,
      conversationId: conversation.id,
      provider: resolved.provider.name,
      model: resolved.model,
      // 'copilot' is not one of the operation types the ai_usage_logs check
      // constraint allows, and this run has no migration; a copilot call is a
      // chat completion, so it is logged and billed as one.
      operationType: 'chat',
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
    });
  } catch (err) {
    logger.error('Copilot completion failed', {
      companyId: params.companyId,
      conversationId: conversation.id,
      mode: params.mode,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError('The copilot could not produce a draft. Try again.', 502, 'copilot_failed');
  }

  const cap = params.mode === 'summarise' ? MAX_SUMMARY_CHARS : MAX_DRAFT_CHARS;
  const { text: marked, cited } = sanitiseCitationMarkers(raw, citations.length);
  const text = marked.slice(0, cap).trim();
  if (!text) {
    throw new AppError('The copilot came back empty. Try again.', 502, 'copilot_empty');
  }

  // Show only the sources the draft actually leaned on; keep all of them when
  // the model cited nothing, so the agent can still see what was available.
  const shown = cited.length > 0 ? citations.filter((c) => cited.includes(c.index)) : citations;

  return {
    mode: params.mode,
    text,
    citations: shown.map(publicCitation),
    facts,
    language,
    provider: resolved.provider.name,
    model: resolved.model,
    disclaimer: DISCLAIMER[params.mode],
  };
}

function buildPrompt(params: {
  mode: CopilotMode;
  language: 'ar' | 'en';
  tone?: CopilotTone;
  draft: string;
  transcript: string;
  contextText: string;
  businessContext: string;
  citationCount: number;
  priorSummary: string | null;
}): { system: string; user: string; maxTokens: number } {
  const languageLine =
    params.language === 'ar'
      ? 'Write in Arabic — the customer is writing in Arabic.'
      : 'Write in English.';
  const toneLine = params.tone ? `Tone: ${TONE_INSTRUCTION[params.tone]}` : '';

  const systemParts: string[] = [
    'You are a copilot for a human support agent. Everything you write is a draft that the agent reads, edits and decides whether to send. You are never talking to the customer.',
    INJECTION_GUARD,
    languageLine,
  ];
  if (toneLine) systemParts.push(toneLine);

  const userParts: string[] = [];
  let maxTokens = 500;

  if (params.mode === 'suggest_reply') {
    systemParts.push(
      [
        'Draft the agent\'s next reply to the customer.',
        'Use only the transcript, the business facts and the knowledge excerpts. If none of them answer the question, say so in the draft and suggest what the agent should find out — never invent a price, a date, a policy or a stock level.',
        params.citationCount > 0
          ? `The knowledge excerpts are numbered 1 to ${params.citationCount}. When a sentence comes from one, put its number in square brackets at the end of that sentence, like [2]. Never use a number outside that range.`
          : 'No knowledge excerpts were found, so do not use square-bracket citations at all.',
        'Write only the reply itself — no greeting to the agent, no explanation of what you did.',
      ].join(' '),
    );
    if (params.businessContext.trim()) {
      userParts.push(`BUSINESS FACTS:\n${wrapUntrusted('BUSINESS FACTS', params.businessContext)}`);
    }
    if (params.contextText.trim()) {
      userParts.push(`KNOWLEDGE EXCERPTS:\n${wrapUntrusted('KNOWLEDGE', params.contextText)}`);
    }
    userParts.push(`CONVERSATION:\n${wrapUntrusted('TRANSCRIPT', params.transcript)}`);
    if (params.draft) {
      userParts.push(
        `The agent has already started typing this — build on it rather than replacing it:\n${wrapUntrusted('AGENT DRAFT', params.draft)}`,
      );
    }
  } else if (params.mode === 'summarise') {
    maxTokens = 400;
    systemParts.push(
      [
        'Summarise this conversation for an agent who is picking it up cold.',
        'Cover, in this order: what the customer wants, what has been promised or established, and what is still open.',
        'State no counts, durations, waiting times, ratings or totals of your own — those are measured separately and shown next to your summary, and a number you estimate would contradict them.',
        'Numbers the customer or agent actually typed (an order number, a price they quoted) may be repeated as their words.',
        'Six short lines at most. No preamble.',
      ].join(' '),
    );
    if (params.priorSummary?.trim()) {
      userParts.push(
        `EARLIER IN THIS CONVERSATION (already summarised):\n${wrapUntrusted('EARLIER SUMMARY', params.priorSummary)}`,
      );
    }
    userParts.push(`CONVERSATION:\n${wrapUntrusted('TRANSCRIPT', params.transcript)}`);
  } else {
    maxTokens = 400;
    systemParts.push(
      [
        'Reword the agent\'s draft.',
        'Keep every fact, number, name, link and commitment exactly as written. Add nothing the draft does not already say, and remove nothing it promises.',
        'The transcript is there only so the rewording fits the conversation. Do not answer anything it raises.',
        'Return only the reworded message.',
      ].join(' '),
    );
    userParts.push(`AGENT DRAFT:\n${wrapUntrusted('AGENT DRAFT', params.draft)}`);
    if (params.transcript) {
      userParts.push(`CONVERSATION (for tone only):\n${wrapUntrusted('TRANSCRIPT', params.transcript)}`);
    }
  }

  return { system: systemParts.join('\n\n'), user: userParts.join('\n\n'), maxTokens };
}
