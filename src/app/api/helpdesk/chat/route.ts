import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getCachedBusinessContext } from '@/lib/ai/business-context';
import {
  buildMessages,
  detectLanguage,
  getConversationSummary,
  getOrCreateConversation,
  getRecentHistory,
  saveMessage,
  summarizeConversationIfNeeded,
} from '@/lib/ai/engine';
import { retrieveContext } from '@/lib/ai/rag';
import { getChatProviderAsync } from '@/lib/ai/providers';
import { runToolLoop } from '@/lib/ai/agent';
import { logAiUsage } from '@/lib/ai/usage';
import { getReplyAllowanceUsage, type ReplyAllowanceUsage } from '@/lib/billing';
import { notifyReplyGateBlocked, type ReplyGate } from '@/lib/ai/inbound';
import { isAiBudgetExceeded } from '@/lib/ai/cost-controls';
import { getAiCreditAccess } from '@/lib/billing/credits';
import { getToolSchemas } from '@/lib/tools';
import { loadContextualQuickActions, loadInternalQuickActions } from '@/lib/quick-actions';
import {
  formatHelpdeskActionCatalog,
  hasHelpdeskRuntime,
  listEnabledHelpdeskActions,
} from '@/lib/helpdesk/runtime';
import { authenticateHelpdeskConnector } from '@/lib/helpdesk/connectors';
import { canShowHelpdeskChat, getHelpdeskChatSettings } from '@/lib/helpdesk/chat-settings';
import { insertHelpdeskAuditLog } from '@/lib/helpdesk/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  botId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  text: z.string().min(1).max(4000),
  currentRoute: z.string().max(200).optional(),
  staffRole: z.string().max(80).optional(),
});

function json(obj: unknown, status = 200) {
  return NextResponse.json(obj, { status });
}

function publicReplyUsage(usage: ReplyAllowanceUsage) {
  return {
    used: usage.used,
    monthlyAllowance: usage.monthlyAllowance,
    extraReplies: usage.extraReplies,
    totalAvailable: usage.totalAvailable,
    remaining: usage.remaining,
    resetAt: usage.resetAt,
  };
}

/**
 * The gates that apply to an INTERNAL assistant. Two of the three the widget
 * runs, and the third is left out on purpose — this is the same decision, for
 * the same reason, as `assertCanSpend` in src/lib/ai/copilot.ts.
 *
 * The AI budget and the credit balance are about MONEY. A staffer's question
 * burns exactly the tokens a visitor's does, so both apply here unchanged; the
 * route previously ran neither, and a company sitting at £0 credit or past the
 * hard stop it set for itself in /company/ai-controls kept spending provider
 * money on this screen at full cost while its widget was switched off.
 *
 * The third gate — the plan's monthly reply allowance — does NOT apply, because
 * as of this change the usage row below is no longer logged as 'chat' and so no
 * longer consumes that allowance. The allowance is the number of answers the
 * company bought for THEIR customers to receive; a staffer asking how to refund
 * an order is not one of them. Gating on it would also stop internal help at
 * precisely the moment the allowance ran out and the team has to answer every
 * conversation by hand — the worst possible time to take their assistant away.
 * The two halves have to move together: while this route logged 'chat', the
 * quota gate it ran was self-inflicted, and dropping the gate without changing
 * the operation type would have let it drain a cap it no longer respected.
 *
 * The order matches `checkReplyGates` so a company crossing both limits is told
 * about the same one wherever they hit it.
 */
type InternalSpendGate = Extract<ReplyGate, 'budget' | 'credit'>;

async function checkInternalSpendGates(companyId: string): Promise<InternalSpendGate | null> {
  const [budgetExceeded, credit] = await Promise.all([
    isAiBudgetExceeded(companyId),
    getAiCreditAccess(companyId),
  ]);
  if (budgetExceeded) return 'budget';
  if (!credit.allowed) return 'credit';
  return null;
}

/** What the staffer is told, and the code the Help Desk client surfaces. */
const INTERNAL_GATE_RESPONSE: Record<InternalSpendGate, { error: string; message: string }> = {
  budget: {
    error: 'ai_budget_exceeded',
    message:
      'The monthly AI spend limit has been reached, so Help Desk AI is paused. Raise or turn off the limit in AI controls to continue.',
  },
  credit: {
    error: 'ai_credit_exhausted',
    message:
      'This account has no AI credit left, so Help Desk AI is paused. Top up your AI credit to continue.',
  },
};

function appRole(platformRole: string | null, suppliedRole?: string): string {
  if (suppliedRole?.trim()) return suppliedRole.trim();
  if (platformRole === ROLES.COMPANY_ADMIN) return 'admin';
  if (platformRole === ROLES.AGENT) return 'staff';
  return platformRole ?? 'staff';
}

function isInternalBot(row: Record<string, unknown>): boolean {
  const appearance = (row.appearance_json as Record<string, unknown> | null) ?? {};
  const caps = Array.isArray(row.capability_flags) ? row.capability_flags.map(String) : [];
  return (
    appearance.assistantAudience === 'internal' ||
    row.bot_type === 'help_desk' ||
    caps.some((cap) => cap.startsWith('internal_'))
  );
}

function approxTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function safeActions(rows: Array<Record<string, unknown>>) {
  return rows.slice(0, 8).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    label: String(row.name ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: (row.description as string) ?? '',
    type: row.action_type as string,
    risk: row.risk as string,
    requiredFields: Array.isArray(row.required_fields) ? row.required_fields : [],
    optionalFields: Array.isArray(row.optional_fields) ? row.optional_fields : [],
    needsConfirmation: Boolean(row.needs_confirmation),
  }));
}

// Words too generic to signal which screen the user wants.
const NAV_STOPWORDS = new Set([
  'how', 'what', 'where', 'when', 'why', 'who', 'the', 'and', 'for', 'you', 'can', 'does', 'with',
  'please', 'show', 'see', 'this', 'that', 'from', 'into', 'are', 'get', 'got', 'need', 'want', 'add',
  'new', 'set', 'use', 'all', 'any', 'help', 'open', 'tell', 'about', 'screen', 'page', 'button',
]);

function queryTerms(text: string): string[] {
  return Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !NAV_STOPWORDS.has(t)),
    ),
  );
}

/**
 * Only surface navigation buttons that actually match what the staffer asked.
 * Previously this dumped the first ~8 connector screens regardless of the
 * question, so "how do I add a category?" showed Settings, Dashboard, Printer,
 * Orders… — noise. We score each screen by term overlap with the question and
 * keep just the top matches (or none, which the UI handles cleanly).
 */
function navigationTargets(rows: Array<Record<string, unknown>>, query: string) {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scored = rows
    .map((row) => {
      const source = (row.source_json as Record<string, unknown> | null) ?? {};
      const navigation = (source.navigation as Record<string, unknown> | null) ?? null;
      const routeId = navigation && typeof navigation.routeId === 'string' ? navigation.routeId : null;
      if (!routeId) return null;
      const haystack = `${row.module ?? ''} ${row.screen ?? ''} ${row.path ?? ''} ${navigation?.label ?? ''}`.toLowerCase();
      const score = terms.reduce((sum, t) => (haystack.includes(t) ? sum + 1 : sum), 0);
      if (score === 0) return null;
      return {
        score,
        target: {
          documentId: row.id as string,
          label: (navigation?.label as string | undefined) ?? `Open ${row.screen}`,
          routeId,
          path: (row.path as string | null) ?? null,
          module: row.module as string,
          screen: row.screen as string,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return scored.map((s) => s.target);
}

/**
 * Help Desk / connector chat clients render answers as plain text (textContent),
 * so markdown emphasis shows up as literal `**asterisks**`. The customer widget
 * renders markdown and keeps its bold — this strip is help-desk-only. We remove
 * bold/italic markers, heading hashes, and inline-code backticks; list markers
 * and numbering are left intact since they read fine as plain text.
 */
function toPlainText(text: string): string {
  return text
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .trim();
}

function shouldSuggestTicket(input: {
  question: string;
  answer: string;
  toolsCalled: string[];
  uiActions: Array<{ action: string; payload: unknown }>;
}): boolean {
  const combined = `${input.question}\n${input.answer}`.toLowerCase();
  const issueIntent =
    /\b(ticket|report (an )?issue|create (a )?(ticket|case)|not working|broken|failed|error|stuck|queued forever|does not work|can't|cannot|unable)\b/i.test(
      combined,
    );
  const unresolvedAnswer =
    /\b(i do not know|i don't know|cannot confirm|could not confirm|not enough information|missing|failed|still running|queued)\b/i.test(
      input.answer,
    );
  const queuedConnectorAction = input.uiActions.some((item) => {
    if (item.action !== 'helpdesk_event' || !item.payload || typeof item.payload !== 'object') return false;
    const status = String((item.payload as Record<string, unknown>).status ?? '');
    return status === 'queued' || status === 'running' || status === 'failed';
  });
  return issueIntent || unresolvedAnswer || (input.toolsCalled.includes('run_helpdesk_action') && queuedConnectorAction);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  const connector = user?.companyId ? null : await authenticateHelpdeskConnector(req);
  const companyId = user?.companyId ?? connector?.companyId ?? null;
  if (!companyId) return json({ error: 'unauthorized' }, 401);
  if (user && user.role !== ROLES.COMPANY_ADMIN && user.role !== ROLES.AGENT && !user.isSuperAdmin) {
    return json({ error: 'forbidden' }, 403);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid_request', issues: parsed.error.issues }, 400);

  const settings = await getHelpdeskChatSettings(companyId);
  const staffRole = appRole(user?.role ?? null, parsed.data.staffRole);
  if (!canShowHelpdeskChat(settings, { route: parsed.data.currentRoute, role: staffRole })) {
    return json(
      {
        error: 'helpdesk_chat_hidden_by_visibility_rules',
        message: 'Help Desk chat is hidden for this screen by the visibility settings.',
      },
      403,
    );
  }

  const sb = createSupabaseServiceClient();
  const { data: bots } = await sb
    .from('bots')
    .select('id,name,system_prompt,capability_flags,appearance_json,bot_type')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  const rows = ((bots ?? []) as Array<Record<string, unknown>>).filter(isInternalBot);
  const bot = parsed.data.botId ? rows.find((row) => row.id === parsed.data.botId) : rows[0];
  if (!bot) return json({ error: 'internal_helpdesk_bot_not_found' }, 404);

  const botId = bot.id as string;
  const capabilityFlags = Array.isArray(bot.capability_flags) ? bot.capability_flags.map(String) : [];
  const language = detectLanguage(parsed.data.text);

  const spendGate = await checkInternalSpendGates(companyId);
  if (spendGate) {
    const replyUsage = await getReplyAllowanceUsage(companyId);
    // The 402 below already tells the staffer what happened and what to do, and
    // that is enough here: this is an internal tool with a signed-in person in
    // front of it, so there is no visitor to apologise to and no handoff to
    // build. What was missing is the company-level alert, and it is the SAME
    // one the customer-facing surfaces fire — once per limit per window across
    // all of them, so a company whose widget went quiet this morning is not
    // alerted again now.
    await notifyReplyGateBlocked(companyId, spendGate, { surface: 'helpdesk_chat' });
    return json(
      {
        ...INTERNAL_GATE_RESPONSE[spendGate],
        replyUsage: publicReplyUsage(replyUsage),
      },
      402,
    );
  }

  // Persist the internal thread so the assistant has memory across turns (same
  // as the customer side). Staff are scoped by their user id; the channel='api'
  // keeps these out of the customer inbox.
  const staffVisitorId = user?.userId ?? (connector ? `connector:${connector.id}` : 'staff');
  const convo = await getOrCreateConversation({
    companyId,
    botId,
    conversationId: parsed.data.conversationId,
    visitorId: staffVisitorId,
    language,
    channel: 'api',
  });

  const [businessContext, resolved, { contextText }, helpdeskActions, docs, initialPills, contextualPills, history, summary] =
    await Promise.all([
      getCachedBusinessContext(companyId),
      getChatProviderAsync(companyId),
      retrieveContext(companyId, botId, parsed.data.text, 6, undefined, 'internal', language),
      hasHelpdeskRuntime(capabilityFlags, 'internal') ? listEnabledHelpdeskActions(companyId) : Promise.resolve([]),
      sb
        .from('helpdesk_connector_documents')
        .select('id,module,screen,path,source_json')
        .eq('company_id', companyId)
        .in('status', ['draft', 'approved'])
        .limit(20),
      loadInternalQuickActions({
        companyId,
        botId,
        context: 'initial',
        capabilities: capabilityFlags,
        settings: {
          enableDefaultPills: (bot.appearance_json as Record<string, unknown> | null)?.enableDefaultPills !== false,
          enableContextualPills: (bot.appearance_json as Record<string, unknown> | null)?.enableContextualPills !== false,
          enableConnectorGeneratedPills:
            (bot.appearance_json as Record<string, unknown> | null)?.enableConnectorGeneratedPills !== false,
        },
        limit: 8,
      }),
      loadContextualQuickActions({
        companyId,
        botId,
        assistantAudience: 'internal',
        latestMessage: parsed.data.text,
        contextText: parsed.data.currentRoute,
        capabilities: capabilityFlags,
        settings: {
          enableDefaultPills: (bot.appearance_json as Record<string, unknown> | null)?.enableDefaultPills !== false,
          enableContextualPills: (bot.appearance_json as Record<string, unknown> | null)?.enableContextualPills !== false,
          enableConnectorGeneratedPills:
            (bot.appearance_json as Record<string, unknown> | null)?.enableConnectorGeneratedPills !== false,
        },
        limit: 5,
      }),
      getRecentHistory(convo.id, companyId),
      getConversationSummary(convo.id, companyId),
    ]);

  const messages = buildMessages({
    systemPrompt: bot.system_prompt as string | null,
    businessContext,
    contextText,
    helpdeskActionCatalog: formatHelpdeskActionCatalog(helpdeskActions),
    summary,
    history,
    language,
  });
  messages.push({
    role: 'user',
    content: parsed.data.currentRoute
      ? `${parsed.data.text}\n\nCurrent app route: ${parsed.data.currentRoute}`
      : parsed.data.text,
  });

  let answer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let toolsCalled: string[] = [];
  const uiActions: Array<{ action: string; payload: unknown }> = [];
  const toolSchemas = getToolSchemas(capabilityFlags, 'internal');
  const toolApiType = resolved.apiType === 'openai' || resolved.apiType === 'anthropic' ? resolved.apiType : null;

  if (toolSchemas.length > 0 && toolApiType && resolved.apiKey) {
    const result = await runToolLoop({
      providerName: toolApiType,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      messages,
      tools: toolSchemas,
      ctx: {
        companyId,
        botId,
        conversationId: convo.id,
        language,
        actorUserId: user?.userId ?? null,
        currentRoute: parsed.data.currentRoute ?? null,
        staffRole,
      },
      temperature: 0.2,
      onAction: (action, payload) => uiActions.push({ action, payload }),
    });
    answer = result.text || 'No answer.';
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    toolsCalled = result.toolsCalled;
  } else {
    const result = await resolved.provider.complete({
      model: resolved.model,
      messages,
      temperature: 0.2,
      maxTokens: 700,
    });
    answer = result.text || 'No answer.';
    inputTokens = approxTokens(messages.map((m) => m.content).join(' '));
    outputTokens = approxTokens(answer);
  }

  // Help-desk clients render plain text — strip markdown so bold doesn't show
  // up as literal **asterisks**. Done once here so the reply, stored history,
  // and audit log are all consistent.
  answer = toPlainText(answer);

  await logAiUsage({
    companyId,
    botId,
    conversationId: convo.id,
    provider: resolved.provider.name,
    model: resolved.model,
    // Internal staff spend, not a sold reply — the same call the copilot makes
    // and for the same reason (see src/lib/ai/copilot.ts and migration 0092).
    // Cost still lands in full: `logAiUsage` deducts the credit and every cost
    // and profit report sums `estimated_cost` across all operation types, so
    // this question is charged for like any other model call. What it must not
    // touch is the plan's reply allowance, which `getMonthlyMessageCount`
    // measures by counting operation_type='chat' rows. Logged as 'chat', a
    // manager spending an afternoon asking the internal assistant how the
    // product works silently drained the answers the company bought for THEIR
    // customers, switched the widget off when it ran out, and showed up on the
    // billing page as "AI replies used" by visitors who never existed.
    // Migration 0097 adds 'helpdesk' to the ai_usage_logs check constraint; if
    // it has not been applied, `logAiUsage` swallows the rejection and the
    // charge is lost, so the two must ship together.
    operationType: 'helpdesk',
    inputTokens,
    outputTokens,
  });
  const replyUsage = await getReplyAllowanceUsage(companyId);

  // Persist the turn so the next message has history, then roll up older context.
  await saveMessage({
    companyId,
    conversationId: convo.id,
    senderType: 'visitor',
    senderId: user?.userId ?? null,
    text: parsed.data.text,
    language,
    channel: 'api',
  });
  await saveMessage({
    companyId,
    conversationId: convo.id,
    senderType: 'ai',
    text: answer,
    language,
    channel: 'api',
  });
  await summarizeConversationIfNeeded({
    conversationId: convo.id,
    companyId,
    provider: resolved.provider,
    model: resolved.model,
  });

  await insertHelpdeskAuditLog({
    companyId,
    actorUserId: user?.userId ?? null,
    source: 'chat',
    question: parsed.data.text,
    answer,
    status: 'info',
    metadata: {
      botId,
      currentRoute: parsed.data.currentRoute ?? null,
      staffRole,
      toolsCalled,
      connectorAuthenticated: Boolean(connector),
    },
  });

  const { data: connectorActions } = await sb
    .from('helpdesk_connector_actions')
    .select('id,name,description,action_type,risk,required_fields,optional_fields,needs_confirmation')
    .eq('company_id', companyId)
    .eq('is_enabled', true)
    .neq('action_type', 'danger')
    .order('risk', { ascending: true })
    .limit(12);

  const pills = [...contextualPills, ...initialPills]
    .map((pill) => ({
      id: pill.id,
      label: pill.label,
      message: typeof pill.config.message_text === 'string' ? pill.config.message_text : pill.label,
      source: pill.source,
      contextMode: pill.contextMode,
    }))
    .filter((pill, index, all) => all.findIndex((x) => x.message === pill.message) === index)
    .slice(0, 8);

  return json({
    ok: true,
    answer,
    conversationId: convo.id,
    bot: { id: botId, name: bot.name },
    toolsCalled,
    uiActions,
    pills,
    navigationTargets: navigationTargets(
      ((docs as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>,
      parsed.data.text,
    ),
    guidedActions: safeActions(((connectorActions ?? []) as Array<Record<string, unknown>>)),
    settings,
    replyUsage: publicReplyUsage(replyUsage),
    shouldSuggestTicket: shouldSuggestTicket({
      question: parsed.data.text,
      answer,
      toolsCalled,
      uiActions,
    }),
  });
}
