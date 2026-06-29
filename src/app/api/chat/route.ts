import { z } from 'zod';
import {
  loadBotByPublicId,
  getOrCreateConversation,
  saveMessage,
  getRecentHistory,
  getConversationSummary,
  summarizeConversationIfNeeded,
  buildMessages,
  detectLanguage,
  isOriginAllowed,
} from '@/lib/ai/engine';
import { detectConversationLanguage } from '@/lib/ai/lang';
import { retrieveContext } from '@/lib/ai/rag';
import { needsRewrite, rewriteQuery } from '@/lib/ai/query-rewrite';
import { getChatProviderAsync, getFallbackChatProviderAsync } from '@/lib/ai/providers';
import { getPlatformAiSettings } from '@/lib/platform-settings';
import { getCachedBusinessContext } from '@/lib/ai/business-context';
import { pickChatModel } from '@/lib/ai/model-routing';
import { getToolSchemas } from '@/lib/tools';
import { runToolLoop } from '@/lib/ai/agent';
import { logAiUsage } from '@/lib/ai/usage';
import { inferFailureReason, logAnswerQuality } from '@/lib/ai/quality';
import { planAllowsAdvancedModel, withinMessageQuota } from '@/lib/billing';
import { getAiCreditAccess } from '@/lib/billing/credits';
import { rateLimitDistributed } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notify';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { loadContextualQuickActions } from '@/lib/quick-actions';
import { assignBestAvailableAgent } from '@/lib/agent-routing';
import { getCachedAnswer, isAiBudgetExceeded, saveCachedAnswer } from '@/lib/ai/cost-controls';
import {
  formatHelpdeskActionCatalog,
  hasHelpdeskRuntime,
  listEnabledHelpdeskActions,
} from '@/lib/helpdesk/runtime';
import type { AIProvider, TokenUsage } from '@/lib/ai/types';

function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}
function* chunkString(s: string): Generator<string> {
  for (const part of s.split(/(\s+)/)) if (part) yield part;
}

/** Whether the advanced model is compatible with the resolved provider family. */
function advancedModelMatchesProvider(providerName: string, model: string): boolean {
  if (providerName === 'openai') return /gpt|^o\d/i.test(model);
  if (providerName === 'anthropic') return /claude/i.test(model);
  return false;
}

// Live status shown in the widget's typing indicator while the bot works, so the
// wait (retrieval + agentic tool calls) feels responsive instead of silent.
const STATUS_TEXT = {
  searching: { en: 'Searching…', ar: 'جاري البحث…' },
  thinking: { en: 'Thinking…', ar: 'جاري التفكير…' },
  product: { en: 'Checking products…', ar: 'جاري التحقق من المنتجات…' },
  order: { en: 'Looking up your order…', ar: 'جاري البحث عن طلبك…' },
  cart: { en: 'Updating your cart…', ar: 'جاري تحديث سلتك…' },
  lead: { en: 'Saving your details…', ar: 'جاري حفظ بياناتك…' },
  appointment: { en: 'Checking availability…', ar: 'جاري التحقق من المواعيد…' },
} as const;
function statusText(key: string, lang: 'ar' | 'en'): string {
  const s =
    (STATUS_TEXT as Record<string, { en: string; ar: string }>)[key] ?? STATUS_TEXT.thinking;
  return lang === 'ar' ? s.ar : s.en;
}
function toolStatusKey(name: string): string {
  if (name.includes('product') || name.includes('stock') || name.includes('menu')) return 'product';
  if (name.includes('order') || name.includes('tracking')) return 'order';
  if (name.includes('cart') || name.includes('checkout')) return 'cart';
  if (name.includes('lead')) return 'lead';
  if (name.includes('appointment')) return 'appointment';
  if (name.includes('helpdesk')) return 'thinking';
  return 'thinking';
}

function asksForHuman(text: string): boolean {
  return /\b(human|agent|representative|person|support team|live chat|talk to someone)\b/i.test(
    text,
  );
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  publicBotId: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  visitorId: z.string().min(1).max(100),
  text: z.string().min(1).max(4000),
});

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const headers = cors(origin);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: 'invalid_request' }, 400, headers);
  }

  // Rate limit per visitor (Module 23) — distributed across instances (Issue #16).
  const rl = await rateLimitDistributed(`chat:${body.publicBotId}:${body.visitorId}`, 20, 60_000);
  if (!rl.ok) return json({ error: 'rate_limited' }, 429, headers);

  const bot = await loadBotByPublicId(body.publicBotId);
  if (!bot) return json({ error: 'bot_not_found' }, 404, headers);
  if (bot.assistantAudience === 'internal') {
    return json({ error: 'internal_assistant_not_available_on_widget' }, 403, headers);
  }
  if (!isOriginAllowed(bot.domainAllowlist, origin)) {
    return json({ error: 'domain_not_allowed' }, 403, headers);
  }

  // Preliminary language (refined with conversation history before replying).
  const language = detectLanguage(body.text);
  const convo = await getOrCreateConversation({
    companyId: bot.companyId,
    botId: bot.id,
    conversationId: body.conversationId,
    visitorId: body.visitorId,
    language,
  });

  const humanActive = !bot.aiEnabled || !convo.aiEnabled || convo.status === 'human_active';
  const visitorMessageId = await saveMessage({
    companyId: bot.companyId,
    conversationId: convo.id,
    senderType: 'visitor',
    senderId: body.visitorId,
    text: body.text,
    language,
    bumpUnread: humanActive,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      send({ type: 'meta', conversationId: convo.id, language });

      if (asksForHuman(body.text) && convo.status !== 'human_active') {
        const sb = createSupabaseServiceClient();
        await sb
          .from('conversations')
          .update({
            ai_enabled: false,
            status: 'needs_human',
            last_message_at: new Date().toISOString(),
          })
          .eq('company_id', bot.companyId)
          .eq('id', convo.id);
        await saveMessage({
          companyId: bot.companyId,
          conversationId: convo.id,
          senderType: 'system',
          text: language === 'ar' ? 'تم طلب موظف بشري.' : 'Human agent requested.',
          language,
        });
        const assignedAgentId = await assignBestAvailableAgent(bot.companyId, convo.id);
        await notify({
          companyId: bot.companyId,
          type: 'human_takeover',
          title: 'Human takeover requested',
          body: body.text,
          data: { conversationId: convo.id, assignedAgentId },
          email: false,
        });
        send({ type: 'human' });
        send({ type: 'done' });
        controller.close();
        return;
      }

      // Human takeover: AI is paused for this conversation — do not call the model.
      if (humanActive) {
        send({ type: 'human' });
        send({ type: 'done' });
        controller.close();
        return;
      }

      // Plan enforcement (Module 19): stop AI replies once the monthly message
      // limit is reached (visitor messages are still saved for the inbox).
      if (!(await withinMessageQuota(bot.companyId))) {
        send({
          type: 'token',
          value:
            language === 'ar'
              ? 'عذراً، المساعد غير متاح مؤقتاً. سيتواصل معك أحد الموظفين.'
              : 'Sorry, the assistant is temporarily unavailable. A team member will follow up.',
        });
        send({ type: 'done' });
        controller.close();
        return;
      }
      if (await isAiBudgetExceeded(bot.companyId)) {
        send({
          type: 'token',
          value:
            language === 'ar'
              ? 'المساعد غير متاح مؤقتا بسبب حد تكلفة الذكاء الاصطناعي.'
              : 'The assistant is temporarily unavailable because the AI budget limit has been reached.',
        });
        send({ type: 'done' });
        controller.close();
        return;
      }

      const creditAccess = await getAiCreditAccess(bot.companyId);
      if (!creditAccess.allowed) {
        send({
          type: 'token',
          value:
            language === 'ar'
              ? 'Ø¹Ø°Ø±Ø§Ù‹ØŒ Ø§Ù„Ù…Ø³Ø§Ø¹Ø¯ ØºÙŠØ± Ù…ØªØ§Ø­ Ù…Ø¤Ù‚ØªØ§Ù‹. Ø³ÙŠØªÙˆØ§ØµÙ„ Ù…Ø¹Ùƒ Ø£Ø­Ø¯ Ø§Ù„ÙØ±ÙŠÙ‚.'
              : 'Sorry, the assistant is temporarily unavailable. A team member will follow up.',
        });
        send({ type: 'done' });
        controller.close();
        return;
      }

      try {
        const startedAt = Date.now();

        // Fetch everything that doesn't depend on the message in ONE parallel
        // batch (history, fresh business facts, summary, provider, settings) to
        // cut sequential round-trips before the first token (latency win).
        const toolSchemas = getToolSchemas(bot.capabilityFlags, bot.assistantAudience);
        const [history, businessContext, summary, resolved, settings, helpdeskActions] = await Promise.all([
          getRecentHistory(convo.id, bot.companyId),
          getCachedBusinessContext(bot.companyId),
          getConversationSummary(convo.id, bot.companyId),
          getChatProviderAsync(),
          getPlatformAiSettings(),
          hasHelpdeskRuntime(bot.capabilityFlags, bot.assistantAudience)
            ? listEnabledHelpdeskActions(bot.companyId)
            : Promise.resolve([]),
        ]);

        // Conversation-aware reply language + follow-up detection (Issues #20/#2).
        const priorTexts = history.slice(0, -1).map((m) => m.content);
        const isFollowUp = history.length > 1;
        const replyLanguage = detectConversationLanguage(body.text, priorTexts);

        // Cache only self-contained, non-follow-up, non-volatile questions (Issue #2).
        const cached = await getCachedAnswer({
          companyId: bot.companyId,
          botId: bot.id,
          question: body.text,
          isFollowUp,
        });
        if (cached) {
          for (const piece of chunkString(cached)) send({ type: 'token', value: piece });
          await saveMessage({
            companyId: bot.companyId,
            conversationId: convo.id,
            senderType: 'ai',
            text: cached,
            language: replyLanguage,
          });
          send({ type: 'done' });
          controller.close();
          return;
        }

        const { provider, apiKey } = resolved;
        // Escalate hard questions to the advanced model when it fits the provider
        // family (Issue #10).
        const canUseAdvancedModel = await planAllowsAdvancedModel(bot.companyId);
        const model =
          canUseAdvancedModel &&
          advancedModelMatchesProvider(provider.name, settings.advancedChatModel)
            ? pickChatModel({
                text: body.text,
                chatModel: resolved.model,
                advancedChatModel: settings.advancedChatModel,
                toolCount: toolSchemas.length,
              }).model
            : resolved.model;

        // Query rewriting → better retrieval for follow-ups / vague / multi-topic
        // questions. Skipped in mock mode and for self-contained questions.
        let searchQueries: string[] | undefined;
        if (provider.name !== 'mock' && needsRewrite(body.text, isFollowUp)) {
          const rw = await rewriteQuery({
            message: body.text,
            history,
            provider,
            model: resolved.model,
            signal: req.signal,
          });
          searchQueries = rw.queries;
          if (rw.usage) {
            await logAiUsage({
              companyId: bot.companyId,
              botId: bot.id,
              conversationId: convo.id,
              provider: provider.name,
              model: resolved.model,
              operationType: 'contextualize',
              inputTokens: rw.usage.inputTokens,
              outputTokens: rw.usage.outputTokens,
            });
          }
        }

        send({ type: 'status', value: statusText('searching', replyLanguage) });
        const { chunks, contextText } = await retrieveContext(
          bot.companyId,
          bot.id,
          body.text,
          6,
          searchQueries,
          bot.assistantAudience,
          replyLanguage,
        );
        const helpdeskActionCatalog = formatHelpdeskActionCatalog(helpdeskActions);
        send({ type: 'status', value: statusText('thinking', replyLanguage) });

        const messages = buildMessages({
          systemPrompt: bot.systemPrompt,
          businessContext,
          contextText,
          helpdeskActionCatalog,
          summary,
          history,
          language: replyLanguage,
        });

        let full = '';
        let inTok = 0;
        let outTok = 0;
        let toolsCalled: string[] = [];
        let streamedAny = false;
        // Inline UI actions the bot asked the widget to render this turn (lead
        // form, product cards, …). Used below to skip a redundant fallback CTA.
        const actionsEmitted = new Set<string>();
        const emitAction = (action: string, payload: unknown) => {
          actionsEmitted.add(action);
          send({ type: 'action', action, payload });
        };
        let usageIn = 0;
        let usageOut = 0;
        const onUsage = (u: TokenUsage) => {
          usageIn = u.inputTokens;
          usageOut = u.outputTokens;
        };

        const streamPlain = async (p: AIProvider, m: string) => {
          for await (const token of p.stream({ model: m, messages, onUsage, signal: req.signal })) {
            full += token;
            streamedAny = true;
            send({ type: 'token', value: token });
          }
        };

        const toolApiType =
          resolved.apiType === 'openai' || resolved.apiType === 'anthropic'
            ? resolved.apiType
            : null;
        if (toolSchemas.length > 0 && toolApiType) {
          // Provider-agnostic agentic tool loop with true streaming (Issues #1/#19).
          // OpenAI-compatible (OpenAI/DeepSeek/Grok) + Anthropic; Gemini uses plain chat.
          try {
            const result = await runToolLoop({
              providerName: toolApiType,
              baseUrl: resolved.baseUrl,
              apiKey: apiKey!,
              model,
              messages,
              tools: toolSchemas,
              ctx: {
                companyId: bot.companyId,
                botId: bot.id,
                conversationId: convo.id,
                language: replyLanguage,
              },
              signal: req.signal,
              onToolStart: (name) =>
                send({ type: 'status', value: statusText(toolStatusKey(name), replyLanguage) }),
              onAction: emitAction,
              onToken: (t) => {
                full += t;
                streamedAny = true;
                send({ type: 'token', value: t });
              },
            });
            if (!full) full = result.text;
            inTok = result.inputTokens;
            outTok = result.outputTokens;
            toolsCalled = result.toolsCalled;
          } catch (err) {
            if (streamedAny) throw err; // partial answer already sent
            const fb = await getFallbackChatProviderAsync(provider.name);
            if (!fb) throw err;
            await streamPlain(fb.provider, fb.model);
          }
        } else {
          // Plain streaming path (no tools / mock) with real usage + fallback (Issues #13/#14/#15).
          try {
            await streamPlain(provider, model);
          } catch (err) {
            if (streamedAny) throw err;
            const fallback = await getFallbackChatProviderAsync(provider.name);
            if (!fallback) throw err;
            await streamPlain(fallback.provider, fallback.model);
          }
        }

        // Prefer real provider-reported usage; fall back to estimate (Issue #15).
        if (usageIn) inTok = usageIn;
        if (usageOut) outTok = usageOut;
        if (!inTok) inTok = approxTokens(messages.map((m) => m.content).join(' '));
        if (!outTok) outTok = approxTokens(full);

        const assistantMessageId = await saveMessage({
          companyId: bot.companyId,
          conversationId: convo.id,
          senderType: 'ai',
          text: full,
          language: replyLanguage,
        });
        await logAiUsage({
          companyId: bot.companyId,
          botId: bot.id,
          conversationId: convo.id,
          provider: provider.name,
          model,
          operationType: 'chat',
          inputTokens: inTok,
          outputTokens: outTok,
        });
        await saveCachedAnswer({
          companyId: bot.companyId,
          botId: bot.id,
          question: body.text,
          answer: full,
          provider: provider.name,
          model,
          toolsCalled,
          isFollowUp,
        });
        const sourceTypes = [
          chunks.length ? 'rag' : '',
          contextText ? 'knowledge' : '',
          ...toolsCalled.map((tool) => {
            if (tool.includes('product') || tool.includes('stock') || tool.includes('menu'))
              return 'product_tool';
            if (tool.includes('order') || tool.includes('tracking')) return 'order_tool';
            if (tool.includes('lead')) return 'lead_tool';
            if (tool.includes('appointment')) return 'appointment_tool';
            if (tool.includes('cart')) return 'cart_tool';
            if (tool.includes('helpdesk')) return 'helpdesk_connector_tool';
            return 'tool';
          }),
        ].filter(Boolean);
        const failureReason = inferFailureReason({
          answer: full,
          retrievedCount: chunks.length,
          toolCalls: toolsCalled,
        });
        await logAnswerQuality({
          companyId: bot.companyId,
          botId: bot.id,
          conversationId: convo.id,
          visitorMessageId,
          assistantMessageId,
          question: body.text,
          answer: full,
          provider: provider.name,
          model,
          inputTokens: inTok,
          outputTokens: outTok,
          latencyMs: Date.now() - startedAt,
          retrievedChunks: chunks.map((c) => ({
            id: c.id,
            documentId: c.documentId,
            score: c.score,
          })),
          toolsCalled,
          sourceTypes,
          failureReason,
        });

        // Fallback CTA: when the bot couldn't answer and hasn't already offered a
        // form this turn, don't dead-end — offer to capture a lead or hand off.
        const weakAnswer = failureReason === 'missing_info' || failureReason === 'weak_retrieval';
        const alreadyOffered =
          actionsEmitted.has('lead_form') ||
          actionsEmitted.has('appointment_form') ||
          actionsEmitted.has('human_handoff');
        const caps = new Set(bot.capabilityFlags);
        const canLead = caps.has('lead_capture') || caps.has('sales_agent');
        const canHuman = caps.has('human_agent_takeover') || caps.has('live_chat');
        if (weakAnswer && !alreadyOffered && (canLead || canHuman)) {
          const ar = replyLanguage === 'ar';
          const ctaActions = [
            canLead ? { kind: 'lead_form', label: ar ? 'اترك بياناتك' : 'Leave details' } : null,
            canHuman ? { kind: 'human_handoff', label: ar ? 'التحدث مع موظف' : 'Talk to a human' } : null,
          ].filter(Boolean);
          emitAction('fallback_cta', {
            message: ar
              ? 'لست متأكداً من ذلك. هل تريد أن يتواصل معك الفريق؟'
              : 'I’m not sure about that. Would you like the team to contact you?',
            actions: ctaActions,
          });
        }
        if (!actionsEmitted.has('quick_replies') && !actionsEmitted.has('fallback_cta')) {
          const contextualPills = await loadContextualQuickActions({
            companyId: bot.companyId,
            botId: bot.id,
            assistantAudience: bot.assistantAudience,
            latestMessage: body.text,
            contextText: `${contextText}\n${full}`,
            capabilities: bot.capabilityFlags,
            settings: {
              enableDefaultPills: bot.appearance.enableDefaultPills !== false,
              enableContextualPills: bot.appearance.enableContextualPills !== false,
              enableConnectorGeneratedPills: bot.appearance.enableConnectorGeneratedPills !== false,
            },
            limit: 4,
          });
          const options = contextualPills.map((pill) => {
            const text = typeof pill.config.message_text === 'string' ? pill.config.message_text : pill.label;
            return text.trim();
          }).filter(Boolean);
          if (options.length > 0) {
            emitAction('quick_replies', { options });
          }
        }
        send({ type: 'done' });
        // Roll up long-chat memory after the visible reply is finished (Issue #9).
        await summarizeConversationIfNeeded({
          conversationId: convo.id,
          companyId: bot.companyId,
          provider,
          model: resolved.model,
        });
      } catch (err) {
        logger.error('Chat engine error', {
          companyId: bot.companyId,
          botId: bot.id,
          conversationId: convo.id,
          module: 'api_chat',
          route: '/api/chat',
          stack: err instanceof Error ? err.stack : undefined,
          error: err instanceof Error ? err.message : String(err),
        });
        send({ type: 'error', value: 'Sorry, something went wrong.' });
        send({ type: 'done' });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
