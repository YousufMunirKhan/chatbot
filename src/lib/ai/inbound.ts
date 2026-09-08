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

  // AI paused / escalated → a human owns this thread; don't auto-reply.
  if (!convo.aiEnabled || convo.status === 'human_active' || convo.status === 'needs_human') {
    return { conversationId: convo.id, answer: null, aiHandled: false };
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
