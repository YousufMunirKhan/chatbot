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

function navigationTargets(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => {
      const source = (row.source_json as Record<string, unknown> | null) ?? {};
      const navigation = (source.navigation as Record<string, unknown> | null) ?? null;
      const routeId = navigation && typeof navigation.routeId === 'string' ? navigation.routeId : null;
      if (!routeId) return null;
      return {
        documentId: row.id as string,
        label: (navigation?.label as string | undefined) ?? `Open ${row.screen}`,
        routeId,
        path: (row.path as string | null) ?? null,
        module: row.module as string,
        screen: row.screen as string,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
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
    return json({ error: 'helpdesk_chat_not_available_here', settings }, 403);
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
      getChatProviderAsync(),
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

  await logAiUsage({
    companyId,
    botId,
    conversationId: convo.id,
    provider: resolved.provider.name,
    model: resolved.model,
    operationType: 'chat',
    inputTokens,
    outputTokens,
  });

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
    navigationTargets: navigationTargets(((docs as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>),
    guidedActions: safeActions(((connectorActions ?? []) as Array<Record<string, unknown>>)),
    settings,
  });
}
