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
import { logger } from '@/lib/logger';

export interface InboundResult {
  conversationId: string;
  answer: string | null;
  aiHandled: boolean;
}

/**
 * Channel-agnostic inbound message processor. Unlike the web /api/chat route
 * (which streams SSE to the browser), this returns the final answer text so a
 * messaging channel (WhatsApp, Instagram, email) can deliver it back over its
 * own transport. Reuses the same knowledge + business-context grounding.
 *
 * Returns answer=null when the conversation is in human hands (AI paused) — the
 * channel should stay silent and let an agent reply from the inbox.
 */
export async function processInboundMessage(params: {
  bot: BotContext;
  visitorId: string;
  text: string;
  channel: string;
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

  // AI paused / escalated → a human owns this thread; don't auto-reply.
  if (!convo.aiEnabled || convo.status === 'human_active' || convo.status === 'needs_human') {
    return { conversationId: convo.id, answer: null, aiHandled: false };
  }

  if (!bot.aiEnabled) {
    return { conversationId: convo.id, answer: null, aiHandled: false };
  }

  try {
    const [businessContext, history, summary, resolved] = await Promise.all([
      getCachedBusinessContext(bot.companyId),
      getRecentHistory(convo.id, bot.companyId),
      getConversationSummary(convo.id, bot.companyId),
      getChatProviderAsync(),
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
      systemPrompt: bot.systemPrompt,
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

    return { conversationId: convo.id, answer, aiHandled: true };
  } catch (err) {
    logger.error('processInboundMessage failed', {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
    return { conversationId: convo.id, answer: null, aiHandled: false };
  }
}
