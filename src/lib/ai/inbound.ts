import type { BotContext } from './engine';
import {
  buildMessages,
  getConversationSummary,
  getOrCreateConversation,
  getRecentHistory,
  saveMessage,
  summarizeConversationIfNeeded,
} from './engine';
import { detectLanguage } from './lang';
import { retrieveContext } from './rag';
import { getCachedBusinessContext } from './business-context';
import { getChatProviderAsync } from './providers';
import { runToolLoop } from './agent';
import { getToolSchemas } from '@/lib/tools';
import { logAiUsage } from './usage';
import { isAiBudgetExceeded } from './cost-controls';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { notify } from '@/lib/notify';
import { allowanceWindowFor, currentMonthStartIso, getSubscription, withinMessageQuota } from '@/lib/billing';
import { getAiCreditAccess } from '@/lib/billing/credits';
import { runFlowTurn } from '@/lib/flows/runtime';
import { blocksToText } from '@/lib/channels/types';
import type { OutboundBlock } from '@/lib/channels/types';

export interface InboundResult {
  conversationId: string;
  answer: string | null;
  aiHandled: boolean;
  /**
   * Rich reply blocks when a flow answered (buttons, galleries, media). Channels
   * that can render them should prefer these over `answer`, which is the same
   * content flattened to text for transports that cannot.
   */
  blocks?: OutboundBlock[];
}

/**
 * Which spend limit refused an AI reply.
 *
 * Three independent gates guard every AI reply and all three are legitimate:
 * `quota` is the reply count the plan sells, `budget` is a USD hard stop the
 * COMPANY sets for itself in /company/ai-controls, and `credit` is the prepaid
 * wallet the reply is actually charged against.
 */
export type ReplyGate = 'quota' | 'budget' | 'credit';

/**
 * Run the three billing gates that must pass before any AI reply.
 *
 * WHY THIS IS SHARED
 * ------------------
 * `/api/chat` — the website widget — enforced all three. This file, the shared
 * pipeline behind WhatsApp, Twilio SMS, email, Instagram, Telegram and
 * Messenger, enforced none, while still logging `operation_type = 'chat'` and
 * so spending the same monthly allowance and deducting from the same wallet. A
 * company over its cap had its widget switched off and every messaging channel
 * still answering at full model cost — the more it overspent, the more channels
 * it had open. One function now decides for both callers, so the two cannot
 * drift apart again.
 *
 * The ORDER is preserved exactly as the widget has always applied it. It
 * decides which limit a customer is told about when more than one has been
 * crossed, and the reply allowance is the one they are paying for and the one
 * the support conversation will be about, so it is still answered first.
 */
export async function checkReplyGates(companyId: string): Promise<ReplyGate | null> {
  if (!(await withinMessageQuota(companyId))) return 'quota';
  if (await isAiBudgetExceeded(companyId)) return 'budget';
  const credit = await getAiCreditAccess(companyId);
  if (!credit.allowed) return 'credit';
  return null;
}

/**
 * What the VISITOR is shown. Deliberately says nothing about allowances,
 * budgets or credit: the visitor is a customer of our customer, and "this
 * business has run out of AI credit" is the company's private billing state,
 * not an answer to their question. All three promise the one thing the block
 * handler below actually delivers — a person.
 *
 * They are still worded differently per gate. The three branches used to emit
 * near-identical copy, so an agent scrolling a transcript could not tell which
 * limit had fired; the wording distinguishes them at a glance and the system
 * note below states it outright.
 */
const GATE_VISITOR_MESSAGE: Record<ReplyGate, { en: string; ar: string }> = {
  quota: {
    en: 'Sorry — I can’t answer this one myself right now. I’ve passed the conversation to the team and someone will reply here shortly.',
    ar: 'عذراً، لا أستطيع الرد على هذه الرسالة بنفسي الآن. لقد حوّلت المحادثة إلى الفريق وسيرد عليك أحد الموظفين هنا قريباً.',
  },
  budget: {
    en: 'Sorry — automatic replies are paused at the moment. I’ve let the team know and someone will follow up here.',
    ar: 'عذراً، الردود التلقائية متوقفة مؤقتاً. لقد أبلغت الفريق وسيتابع معك أحد الموظفين هنا.',
  },
  credit: {
    en: 'Sorry — I can’t carry on with this one right now. I’ve handed the conversation to the team and someone will get back to you here.',
    ar: 'عذراً، لا يمكنني متابعة هذه المحادثة الآن. لقد سلّمتها إلى الفريق وسيتواصل معك أحد الموظفين هنا.',
  },
};

/**
 * The agent-facing half of the same event. Saved as a `system` message so it
 * sits in the transcript next to the apology the visitor got, which is where an
 * agent picking the thread up will look for "why am I doing this by hand?".
 */
const GATE_INTERNAL_NOTE: Record<ReplyGate, string> = {
  quota: 'AI reply blocked: this plan’s monthly reply allowance is used up. Handed to a human.',
  budget: 'AI reply blocked: the AI spend limit set in AI controls has been reached. Handed to a human.',
  credit: 'AI reply blocked: the AI credit balance is empty. Handed to a human.',
};

/**
 * The shared `data_json.reason` each gate files its alert under.
 *
 * WHY A KEY THAT IS NOT `gate`
 * ----------------------------
 * `@/lib/billing/usage-alerts` raises the SAME `over_usage_limit` notification
 * type for the meters that are about to stop the assistant, and it deduped on
 * `data_json->>alert` while this file deduped on `data_json->>gate`. Neither
 * discriminator appeared in the other's rows, so neither side could see the
 * other's alert and a company received roughly four near-identical "your
 * assistant has stopped" emails per window instead of two. Both sides now write
 * and dedupe on one key with one vocabulary, so the warning at 100% of the
 * allowance and the block that follows it are one alert, not two.
 *
 * `gate` is still written alongside it — it is this file's own vocabulary and
 * the notification payload is read by the billing page — but it is no longer
 * what the dedupe reads.
 */
const GATE_ALERT_REASON: Record<ReplyGate, 'replies_100' | 'budget_exceeded' | 'credit_empty'> = {
  quota: 'replies_100',
  budget: 'budget_exceeded',
  credit: 'credit_empty',
};

/** The company-facing alert. Each names the one thing that switches AI back on. */
const GATE_ALERT: Record<ReplyGate, { title: string; body: string }> = {
  quota: {
    title: 'Monthly AI replies used up',
    body: 'The assistant has stopped replying and new conversations are going to your inbox for a human to answer. Add extra replies or move up a plan to switch it back on.',
  },
  budget: {
    title: 'AI spend limit reached',
    body: 'The AI cost limit you set has stopped the assistant, so new conversations are going to your inbox for a human to answer. Raise or turn off the limit in AI controls.',
  },
  credit: {
    title: 'AI credit balance is empty',
    body: 'The assistant has stopped replying and new conversations are going to your inbox for a human to answer. Top up your AI credit to switch it back on.',
  },
};

/**
 * The window a given gate resets on.
 *
 * Each gate runs on its own clock, so each is asked about its own: the reply
 * allowance resets on the subscription period (calendar month when Stripe has
 * not written one), while the AI budget is measured over the calendar month and
 * included credit is topped up once per UTC calendar month. It decides both how
 * often the company is alerted and — since a block is only remembered for the
 * window it happened in — when a paused thread is allowed to speak again.
 */
async function gateWindowStart(companyId: string, gate: ReplyGate): Promise<string> {
  if (gate === 'quota') return allowanceWindowFor(await getSubscription(companyId)).start;
  return currentMonthStartIso();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The two reasons a conversation has AI switched off, and why telling them
 * apart matters more here than on the widget.
 *
 * `ai_enabled = false` + `status = 'needs_human'` is how a human takeover is
 * recorded AND how a blocked billing gate used to be recorded. On the widget
 * that conflation is survivable: a conversation is roughly a visit. On
 * WhatsApp, SMS, email and Telegram `processInboundMessage` resolves the thread
 * with `reuseByVisitor`, so it is ONE long-lived thread per contact — a billing
 * block that lasted an afternoon silenced that contact's thread for good, and
 * `assignBestAvailableAgent` returns without assigning anyone when nobody is
 * online, which is the normal state of the one-seat customer who just hit the
 * cap. The customer got no AI, no human and no way back short of an operator
 * editing the row. Before the gates were enforced here they at least got a
 * reply, so the fix was worse than the bug.
 *
 * So the block STAMPS ITS REASON on the conversation and this reads it back. A
 * pause a person owns stays owned; a pause a spend limit caused is lifted by
 * the same limits clearing, with nobody touching the account by hand.
 */
const AI_PAUSE_KEY = 'aiPause';
const BILLING_PAUSE_REASON = 'billing_gate';

export interface BillingPause {
  gate: ReplyGate;
  /** The gate's window at the time of the block — see `gateWindowStart`. The
   *  apology is repeated when a later message falls in a newer window, so a
   *  waiting customer is told once per window rather than once per message. */
  windowStart: string;
  /** When the block happened, used to spot a human who has since stepped in. */
  at: string;
}

function readBillingPause(stateJson: unknown): BillingPause | null {
  if (!isRecord(stateJson)) return null;
  const raw = stateJson[AI_PAUSE_KEY];
  if (!isRecord(raw) || raw.reason !== BILLING_PAUSE_REASON) return null;
  const gate = raw.gate;
  if (gate !== 'quota' && gate !== 'budget' && gate !== 'credit') return null;
  return {
    gate,
    windowStart: typeof raw.windowStart === 'string' ? raw.windowStart : '',
    at: typeof raw.at === 'string' ? raw.at : '',
  };
}

/**
 * Why AI is off on this thread: a person, or a spend limit.
 *
 * Answers `human` unless the row positively proves otherwise — an unreadable
 * row, an unrecognised pause or anything written before this stamp existed all
 * keep the old, safe behaviour of staying quiet under a human. Only a thread
 * this file paused itself, and that no person has spoken in since, is treated
 * as recoverable.
 *
 * Exported for /api/chat: the widget has the same conflation, milder only
 * because a widget conversation is usually a visit — but the id is supplied by
 * the client and a returning visitor can present one from last month.
 */
export async function whyIsAiOff(
  companyId: string,
  conversationId: string,
): Promise<{ owner: 'human' } | { owner: 'billing'; pause: BillingPause }> {
  const sb = createSupabaseServiceClient();
  // Service-role client: the company_id filter is the tenant boundary.
  const { data, error } = await sb
    .from('conversations')
    .select('status,first_agent_reply_at,state_json')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) {
    if (error) {
      logger.warn('Could not read why AI is paused on a conversation; staying quiet', {
        companyId,
        conversationId,
        module: 'ai.inbound',
        error: error.message,
      });
    }
    return { owner: 'human' };
  }

  const row = data as { status?: string | null; first_agent_reply_at?: string | null; state_json?: unknown };
  // A deliberate takeover (`pauseAiAction`, an agent replying from the inbox)
  // lands on `human_active`, and a first agent reply is recorded whichever
  // surface it came from. Either means the thread is spoken for.
  if (row.status === 'human_active' || row.first_agent_reply_at) return { owner: 'human' };

  const pause = readBillingPause(row.state_json);
  if (!pause) return { owner: 'human' };

  // The stamp survives whatever happens next, so check nobody has taken the
  // thread over since without going through the columns above — a flow handoff
  // and the "customer asked for a human" branch both write `needs_human` and
  // leave the stamp in place. One indexed (conversation_id, created_at) probe,
  // and only on a thread that is already paused.
  if (pause.at) {
    const { data: agentReplies } = await sb
      .from('messages')
      .select('id')
      .eq('company_id', companyId)
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'agent')
      .gt('created_at', pause.at)
      .limit(1);
    if (agentReplies && agentReplies.length > 0) return { owner: 'human' };
  }

  return { owner: 'billing', pause };
}

/**
 * Hand a billing-paused thread back to the AI now that the gates pass.
 *
 * Guarded on `status = 'needs_human'`, which is the status the block wrote: if
 * a person took the thread over between the read above and this write they are
 * on `human_active`, no row matches, and the caller stays silent rather than
 * talking over them. Returns whether AI actually got the thread back.
 *
 * Exported alongside `whyIsAiOff` so the widget can recover a thread the same
 * way rather than growing its own copy of the rule.
 */
export async function liftBillingPause(companyId: string, conversationId: string): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data: current } = await sb
    .from('conversations')
    .select('state_json')
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .maybeSingle();
  const state = isRecord((current as { state_json?: unknown } | null)?.state_json)
    ? { ...((current as { state_json: Record<string, unknown> }).state_json) }
    : {};
  delete state[AI_PAUSE_KEY];

  const { data: updated, error } = await sb
    .from('conversations')
    .update({ ai_enabled: true, status: 'ai_active', state_json: state })
    .eq('company_id', companyId)
    .eq('id', conversationId)
    .eq('status', 'needs_human')
    .select('id');
  if (error) {
    logger.error('Could not lift a billing pause on a conversation', {
      companyId,
      conversationId,
      module: 'ai.inbound',
      error: error.message,
    });
    return false;
  }
  return (updated ?? []).length > 0;
}

/**
 * Tell the company its assistant has stopped — ONCE per limit, per window.
 *
 * WHY THE NOTIFICATIONS TABLE IS THE LOCK
 * ---------------------------------------
 * `over_usage_limit` has been declared in `@/lib/notify` and routed to
 * /company/billing in the push fan-out since they were written, and nothing
 * ever fired it. Firing it per blocked message is not an option: a busy site
 * would push, email and Slack the same admin hundreds of times in an afternoon,
 * which is how a company mutes the channel that carries every other alert too.
 *
 * The dedupe reads the row this function is about to write. A dedicated
 * "already alerted" table would need a migration, a row per company per window
 * and a story for cleaning it up, and would still be read on exactly this code
 * path — it would buy nothing the notification itself does not already record.
 * `notifications` is indexed on (company_id, created_at desc), the extra
 * `type` + `reason` filters run over the handful of rows that survives, and the
 * query only happens on the blocked path, which is by definition not the hot
 * one.
 *
 * WHICH WINDOW
 * ------------
 * Each gate resets on its own clock and is asked about its own — see
 * `gateWindowStart`. Asking about the wrong window would either re-alert
 * mid-window or stay silent through a reset.
 *
 * Two blocked messages arriving at once can both miss the row and both alert.
 * Two is not hundreds, and the alternative — a unique index, so the loser's
 * insert fails — buys a duplicate-free inbox at the cost of a migration for a
 * notification. A failed read stays SILENT rather than alerting: a transient
 * error costs one alert, whereas alerting on every read failure is the
 * hundreds-per-afternoon behaviour this whole function exists to prevent, and
 * the visitor-facing handoff below works either way.
 */
export async function notifyReplyGateBlocked(
  companyId: string,
  gate: ReplyGate,
  context?: Record<string, unknown>,
  /** Pass the window when the caller has already resolved it, to save the
   *  subscription read; it is the same value `gateWindowStart` returns. */
  windowStart?: string,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const since = windowStart ?? (await gateWindowStart(companyId, gate));
  const reason = GATE_ALERT_REASON[gate];

  // The service-role client bypasses RLS, so this company_id filter is the
  // tenant boundary. `companyId` is resolved from the bot / session, never a body.
  const { data: already, error } = await sb
    .from('notifications')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', 'over_usage_limit')
    .eq('data_json->>reason', reason)
    .gte('created_at', since)
    .limit(1);
  if (error) {
    logger.warn('Could not check for an existing usage-limit alert; staying quiet', {
      companyId,
      module: 'ai.inbound',
      gate,
      error: error.message,
    });
    return;
  }
  if (already && already.length > 0) return;

  const alert = GATE_ALERT[gate];
  await notify({
    companyId,
    type: 'over_usage_limit',
    title: alert.title,
    body: alert.body,
    data: { ...context, reason, gate, windowStart: since },
    // The product has stopped doing the thing it is sold for. That is worth an
    // email, not just a bell the admin sees next time they open the dashboard.
    email: true,
  });
}

/**
 * Turn a blocked AI reply into a real human handoff.
 *
 * WHAT THIS FIXES
 * ---------------
 * Every gate branch used to stream an apology and close the socket, and that
 * was the whole of it: the apology was never written to the transcript, the
 * conversation kept `status = 'ai_active'` — which the inbox's default queue
 * (`status = 'needs_human'`) does not show — unread was not bumped, and nobody
 * was told. The message promised a team member would follow up and no team
 * member could ever see that they had been volunteered. The pricing page makes
 * that promise explicitly, so the product did not do what it sells.
 *
 * This is the same sequence the "customer asked for a human" branch in
 * /api/chat performs, for the same reason: persist what the visitor was shown,
 * put the thread in the human queue, and page the company.
 *
 * NEVER THROWS
 * ------------
 * The widget caller runs inside a `ReadableStream.start()`, outside its own
 * try/catch, where an exception errors the stream mid-flight and the visitor
 * gets a broken connection instead of the apology. Bookkeeping failing must not
 * cost the visitor the one message that tells them a person is coming, so
 * everything here is best-effort and the message is returned regardless.
 */
export async function handleReplyGateBlock(params: {
  companyId: string;
  conversationId: string;
  gate: ReplyGate;
  language: 'ar' | 'en';
  channel: string;
  /**
   * Whether this call should mark the thread unread. The visitor's own message
   * bumps it on the messaging channels but not on the widget, where it was
   * saved while the AI was still expected to answer — so the widget asks for it
   * here and the channels do not, and the thread is counted once either way.
   */
  bumpUnread: boolean;
  /** The gate's current window, when the caller has already resolved it. Saves
   *  a subscription read and keeps the stamp and the alert on one window. */
  windowStart?: string;
}): Promise<string> {
  const message = GATE_VISITOR_MESSAGE[params.gate][params.language];
  const { companyId, conversationId, channel, language } = params;

  try {
    await saveMessage({
      companyId,
      conversationId,
      senderType: 'ai',
      text: message,
      language,
      channel,
      bumpUnread: params.bumpUnread,
    });
    await saveMessage({
      companyId,
      conversationId,
      senderType: 'system',
      text: GATE_INTERNAL_NOTE[params.gate],
      language,
      channel,
    });

    // Queue the thread ourselves before trying to route it.
    // `assignBestAvailableAgent` sets `status` and `ai_enabled` too, but it
    // returns early without touching the row when the company has nobody to
    // assign to — and a conversation that no queue shows is exactly the failure
    // being fixed here. Setting them first makes the handoff independent of
    // whether routing finds anyone.
    //
    // The pause is STAMPED with its reason. `ai_enabled: false` on its own is
    // indistinguishable from a human takeover, and on a messaging channel the
    // thread is the contact's only one — see `whyIsAiOff`, which reads this
    // back and lets the AI have the thread again once the gates clear, instead
    // of leaving a returning customer in permanent silence.
    const sb = createSupabaseServiceClient();
    const windowStart = params.windowStart ?? (await gateWindowStart(companyId, params.gate));

    // Read-modify-write because PostgREST cannot express `state_json ||
    // '{...}'`; jsonb concatenation would need an RPC and therefore a
    // migration, to merge one key into one conversation on the blocked path.
    // Two writers racing here lose a merge on a single row, which is cheaper.
    const { data: currentState } = await sb
      .from('conversations')
      .select('state_json')
      .eq('company_id', companyId)
      .eq('id', conversationId)
      .maybeSingle();
    const stateJson = isRecord((currentState as { state_json?: unknown } | null)?.state_json)
      ? { ...((currentState as { state_json: Record<string, unknown> }).state_json) }
      : {};

    const { error: convoError } = await sb
      .from('conversations')
      .update({
        ai_enabled: false,
        status: 'needs_human',
        last_message_at: new Date().toISOString(),
        state_json: {
          ...stateJson,
          [AI_PAUSE_KEY]: {
            reason: BILLING_PAUSE_REASON,
            gate: params.gate,
            windowStart,
            at: new Date().toISOString(),
          },
        },
      })
      .eq('company_id', companyId)
      .eq('id', conversationId);
    if (convoError) {
      logger.error('Could not queue a gate-blocked conversation for a human', {
        companyId,
        conversationId,
        module: 'ai.inbound',
        gate: params.gate,
        error: convoError.message,
      });
    }

    // Imported lazily on purpose. `@/lib/agent-routing` reaches
    // `@/modules/company/data`, and from there `next/navigation` and the
    // cookie-bound session — this module has to stay importable from the
    // webhook routes and the offline channel tests, which have neither. The
    // same deferral pattern is used in `@/lib/billing` for the same reason.
    try {
      const { assignBestAvailableAgent } = await import('@/lib/agent-routing');
      await assignBestAvailableAgent(companyId, conversationId);
    } catch (err) {
      logger.warn('Could not assign an agent to a gate-blocked conversation', {
        companyId,
        conversationId,
        module: 'ai.inbound',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await notifyReplyGateBlocked(companyId, params.gate, { conversationId, channel }, windowStart);
  } catch (err) {
    logger.error('Gate-blocked handoff failed', {
      companyId,
      conversationId,
      module: 'ai.inbound',
      gate: params.gate,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return message;
}

/**
 * Channel-agnostic inbound message processor. Unlike the web /api/chat route
 * (which streams SSE to the browser), this returns the final answer text so a
 * messaging channel (WhatsApp, Instagram, email) can deliver it back over its
 * own transport. Reuses the same knowledge + business-context grounding.
 *
 * Returns answer=null when the conversation is in human hands (AI paused) — the
 * channel should stay silent and let an agent reply from the inbox. A thread
 * paused by a spend limit rather than by a person is NOT in human hands: it
 * comes back by itself as soon as the gates pass (see `whyIsAiOff`), because on
 * these channels it is the contact's one and only thread.
 */
export async function processInboundMessage(params: {
  bot: BotContext;
  visitorId: string;
  text: string;
  channel: string;
  /** Display name from the channel profile, used by flows and the inbox. */
  contactName?: string | null;
  /** Ad id / ref parameter / entry point that brought the customer here. */
  referral?: string | null;
  /** `comment` events come from a public post rather than a private thread. */
  kind?: 'message' | 'comment';
}): Promise<InboundResult> {
  const { bot, visitorId, text, channel } = params;
  const language = detectLanguage(text);

  const convo = await getOrCreateConversation({
    companyId: bot.companyId,
    botId: bot.id,
    visitorId,
    language,
    channel,
    reuseByVisitor: true,
  });

  await saveMessage({
    companyId: bot.companyId,
    conversationId: convo.id,
    senderType: 'visitor',
    senderId: visitorId,
    text,
    language,
    channel,
    bumpUnread: true,
  });

  // AI paused / escalated. Two very different things land here and conflating
  // them is what made a spend limit permanent on these channels: a thread a
  // person deliberately took over is theirs and must stay off AI, but a thread
  // this file paused because a gate was closed is temporary and has to come
  // back on its own — `reuseByVisitor` above means it is the contact's ONLY
  // thread, so "never again" means never again for that customer.
  //
  // A billing pause therefore falls through into the normal pipeline: flows
  // still run (they cost nothing, exactly as at the limit), and the gates below
  // either block this turn again or lift the pause and answer.
  let billingPause: BillingPause | null = null;
  if (!convo.aiEnabled || convo.status === 'human_active' || convo.status === 'needs_human') {
    const paused = await whyIsAiOff(bot.companyId, convo.id);
    if (paused.owner !== 'billing') {
      return { conversationId: convo.id, answer: null, aiHandled: false };
    }
    billingPause = paused.pause;
  }

  // --- Flows answer before the AI does --------------------------------------
  // A live flow that matches this message owns the turn. When it hands back
  // (an `ai` block, or an answer none of its buttons matched) its messages so
  // far become the prefix and the assistant finishes the turn.
  const flowTurn = await runFlowTurn({
    companyId: bot.companyId,
    botId: bot.id,
    conversationId: convo.id,
    channel,
    text,
    visitorId,
    contactName: params.contactName ?? null,
    referral: params.referral ?? null,
    isFirstMessage: Boolean(convo.isNew),
    kind: params.kind ?? 'message',
  });

  const prefixBlocks: OutboundBlock[] = flowTurn?.blocks ?? [];
  const prefixText = prefixBlocks.length ? blocksToText(prefixBlocks) : '';
  if (prefixText) {
    await saveMessage({
      companyId: bot.companyId,
      conversationId: convo.id,
      senderType: 'ai',
      text: prefixText,
      language,
      channel,
    });
  }

  if (flowTurn && !flowTurn.handoffToAi) {
    // The flow is done talking for this turn (it is waiting on an answer, it
    // finished, or it escalated to a human).
    return {
      conversationId: convo.id,
      answer: prefixText || null,
      blocks: prefixBlocks.length ? prefixBlocks : undefined,
      aiHandled: !flowTurn.handoffToHuman,
    };
  }

  if (!bot.aiEnabled) {
    return {
      conversationId: convo.id,
      answer: prefixText || null,
      blocks: prefixBlocks.length ? prefixBlocks : undefined,
      aiHandled: false,
    };
  }

  // Plan enforcement (Module 19), the same three gates the website widget
  // applies. Deliberately AFTER the flow above and before the model call: a
  // published flow costs no tokens and spends no allowance, so it must keep
  // running at the limit exactly as it does on the widget.
  //
  // A blocked customer on WhatsApp must not be met with silence — the channel
  // returns `answer: null` for a thread a human owns, and this is not that: the
  // human does not know about it yet. So the block is answered on the channel
  // and the thread is put in the inbox queue.
  const gate = await checkReplyGates(bot.companyId);
  if (gate) {
    const windowStart = await gateWindowStart(bot.companyId, gate);

    // Already apologised on this thread, for this gate, in this window: the
    // thread is in the human queue, the visitor's own message has bumped it
    // unread and the company has been alerted, so all that is left to repeat is
    // the apology itself — and telling a waiting customer "someone will reply
    // shortly" after every message they send is its own kind of unhelpful.
    // A new window (or a different gate) is new information and is said again.
    const toldAlready =
      billingPause !== null &&
      billingPause.gate === gate &&
      Date.parse(billingPause.windowStart) >= Date.parse(windowStart);
    if (toldAlready) {
      return {
        conversationId: convo.id,
        answer: prefixText || null,
        blocks: prefixBlocks.length ? prefixBlocks : undefined,
        aiHandled: false,
      };
    }

    const blocked = await handleReplyGateBlock({
      companyId: bot.companyId,
      conversationId: convo.id,
      gate,
      language,
      channel,
      // The visitor's message above already bumped unread on this thread.
      bumpUnread: false,
      windowStart,
    });
    return {
      conversationId: convo.id,
      answer: [prefixText, blocked].filter(Boolean).join('\n\n'),
      blocks: prefixBlocks.length ? [...prefixBlocks, { type: 'text', text: blocked }] : undefined,
      aiHandled: false,
    };
  }

  // The gates pass on a thread an earlier block paused — the allowance reset,
  // the wallet was topped up, or the budget was raised. Hand it back to the AI
  // before answering so the row stops claiming a human is on it, and so the
  // inbox queue is not left holding a thread nobody needs to look at.
  if (billingPause) {
    const lifted = await liftBillingPause(bot.companyId, convo.id);
    if (!lifted) {
      // Someone took the thread over between the two reads. It is theirs.
      return {
        conversationId: convo.id,
        answer: prefixText || null,
        blocks: prefixBlocks.length ? prefixBlocks : undefined,
        aiHandled: false,
      };
    }
  }

  try {
    const [businessContext, history, summary, resolved] = await Promise.all([
      getCachedBusinessContext(bot.companyId),
      getRecentHistory(convo.id, bot.companyId),
      getConversationSummary(convo.id, bot.companyId),
      getChatProviderAsync(bot.companyId),
    ]);

    const { contextText } = await retrieveContext(
      bot.companyId,
      bot.id,
      text,
      6,
      undefined,
      'customer',
      language,
    );

    const messages = buildMessages({
      systemPrompt: flowTurn?.aiInstruction
        ? [bot.systemPrompt ?? '', `Instruction for this reply: ${flowTurn.aiInstruction}`].join('\n\n').trim()
        : bot.systemPrompt,
      businessContext,
      contextText,
      summary,
      history,
      language,
    });

    // Give non-web channels the same tools as the website bot (stock, orders,
    // leads, appointments) when the provider supports tool calls; otherwise fall
    // back to a plain knowledge-grounded completion.
    const toolSchemas = getToolSchemas(bot.capabilityFlags, 'customer');
    const toolApiType =
      resolved.apiType === 'openai' || resolved.apiType === 'anthropic' ? resolved.apiType : null;

    let answer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (toolSchemas.length > 0 && toolApiType && resolved.apiKey) {
      const r = await runToolLoop({
        providerName: toolApiType,
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        messages,
        tools: toolSchemas,
        ctx: { companyId: bot.companyId, botId: bot.id, conversationId: convo.id, language },
      });
      answer = (r.text || '').trim();
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } else {
      const result = await resolved.provider.complete({
        model: resolved.model,
        messages,
        temperature: 0.3,
        maxTokens: 600,
      });
      answer = result.text.trim();
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
    }

    await saveMessage({
      companyId: bot.companyId,
      conversationId: convo.id,
      senderType: 'ai',
      text: answer,
      language,
      channel,
    });

    await logAiUsage({
      companyId: bot.companyId,
      botId: bot.id,
      conversationId: convo.id,
      provider: resolved.provider.name,
      model: resolved.model,
      operationType: 'chat',
      inputTokens,
      outputTokens,
    });

    await summarizeConversationIfNeeded({
      conversationId: convo.id,
      companyId: bot.companyId,
      provider: resolved.provider,
      model: resolved.model,
    });

    return {
      conversationId: convo.id,
      answer: [prefixText, answer].filter(Boolean).join('\n\n') || null,
      blocks: prefixBlocks.length ? [...prefixBlocks, { type: 'text', text: answer }] : undefined,
      aiHandled: true,
    };
  } catch (err) {
    logger.error('processInboundMessage failed', {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      conversationId: convo.id,
      answer: prefixText || null,
      blocks: prefixBlocks.length ? prefixBlocks : undefined,
      aiHandled: false,
    };
  }
}
