import { createSupabaseServiceClient } from '@/lib/db/server';
import { publicCitation, resolveCitations, retrieveContext } from './rag';
import { getChatProviderAsync } from './providers';
import { buildMessages } from './engine';
import { getCachedBusinessContext } from './business-context';
import { detectLanguage } from './lang';
import { getToolSchemas } from '@/lib/tools';
import { runToolLoop } from './agent';
import {
  formatHelpdeskActionCatalog,
  hasHelpdeskRuntime,
  listEnabledHelpdeskActions,
} from '@/lib/helpdesk/runtime';

/** The handful of bot fields the answer pipeline actually needs. */
export interface AssistantBot {
  id: string | null;
  systemPrompt: string | null;
  capabilityFlags: string[];
  assistantAudience: 'customer' | 'internal';
}

export const BOT_COLUMNS = 'id, system_prompt, capability_flags, appearance_json, bot_type';

/**
 * Read a `bots` row into the shape the pipeline wants. The audience lives in
 * three places for historical reasons — an appearance field, the bot type, and
 * the `internal_` capability prefix — and any one of them makes a bot internal.
 */
export function describeBot(row: Record<string, unknown> | null | undefined): AssistantBot {
  const appearance = (row?.appearance_json as Record<string, unknown> | null) ?? {};
  const capabilityFlags = Array.isArray(row?.capability_flags)
    ? (row!.capability_flags as unknown[]).map(String)
    : [];
  const internal =
    appearance.assistantAudience === 'internal' ||
    row?.bot_type === 'help_desk' ||
    capabilityFlags.some((cap) => cap.startsWith('internal_'));
  return {
    id: (row?.id as string | undefined) ?? null,
    systemPrompt: (row?.system_prompt as string | undefined) ?? null,
    capabilityFlags,
    assistantAudience: internal ? 'internal' : 'customer',
  };
}

/** The company's bots, oldest first — the order every picker here relies on. */
export async function loadCompanyBots(companyId: string): Promise<Array<Record<string, unknown>>> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bots')
    .select(BOT_COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Run one question through the live answer pipeline (active provider + business
 * facts + retrieved knowledge) and return the answer — without saving anything.
 * Powers the company "Test your assistant" box so a business can verify its
 * changes before customers do. Knowledge path only (no tool execution).
 *
 * The citations come back with the answer for the same reason they do on the
 * widget: an owner testing their assistant is checking whether it made
 * something up, and the retrieved excerpts are the only honest way to tell.
 */
export async function previewAnswer(params: {
  companyId: string;
  question: string;
}): Promise<{
  answer: string;
  citations: Array<ReturnType<typeof publicCitation>>;
}> {
  const rows = await loadCompanyBots(params.companyId);
  const botRow =
    rows.find((row) => describeBot(row).assistantAudience === 'internal') ?? rows[0] ?? null;
  const bot = describeBot(botRow);

  const language = detectLanguage(params.question);
  const [{ chunks, contextText }, businessContext, resolved, helpdeskActions] = await Promise.all([
    retrieveContext(params.companyId, bot.id, params.question, 6, undefined, bot.assistantAudience),
    getCachedBusinessContext(params.companyId),
    getChatProviderAsync(),
    hasHelpdeskRuntime(bot.capabilityFlags, bot.assistantAudience)
      ? listEnabledHelpdeskActions(params.companyId)
      : Promise.resolve([]),
  ]);
  const citationsPromise =
    chunks.length > 0 ? resolveCitations(params.companyId, chunks).catch(() => []) : Promise.resolve([]);

  const messages = buildMessages({
    systemPrompt: bot.systemPrompt,
    businessContext,
    contextText,
    helpdeskActionCatalog: formatHelpdeskActionCatalog(helpdeskActions),
    summary: null,
    history: [],
    language,
  });
  messages.push({ role: 'user', content: params.question });

  const toolSchemas = getToolSchemas(bot.capabilityFlags, bot.assistantAudience);
  const toolApiType =
    resolved.apiType === 'openai' || resolved.apiType === 'anthropic'
      ? resolved.apiType
      : null;
  if (toolSchemas.length > 0 && toolApiType && resolved.apiKey) {
    const result = await runToolLoop({
      providerName: toolApiType,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      messages,
      tools: toolSchemas,
      ctx: {
        companyId: params.companyId,
        botId: bot.id,
        conversationId: null,
        language,
      },
      temperature: 0.2,
    });
    return {
      answer: result.text || 'No answer.',
      citations: (await citationsPromise).map(publicCitation),
    };
  }

  const res = await resolved.provider.complete({
    model: resolved.model,
    messages,
    temperature: 0.3,
    maxTokens: 500,
  });
  return {
    answer: res.text || 'No answer.',
    citations: (await citationsPromise).map(publicCitation),
  };
}
