import { createSupabaseServiceClient } from '@/lib/db/server';
import { retrieveContext } from './rag';
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

/**
 * Run one question through the live answer pipeline (active provider + business
 * facts + retrieved knowledge) and return the answer — without saving anything.
 * Powers the company "Test your assistant" box so a business can verify its
 * changes before customers do. Knowledge path only (no tool execution).
 */
export async function previewAnswer(params: {
  companyId: string;
  question: string;
}): Promise<{ answer: string }> {
  const sb = createSupabaseServiceClient();
  const { data: bots } = await sb
    .from('bots')
    .select('id, system_prompt, capability_flags, appearance_json, bot_type')
    .eq('company_id', params.companyId)
    .order('created_at', { ascending: true });
  const rows = (bots ?? []) as Array<Record<string, unknown>>;
  const bot =
    rows.find((row) => {
      const appearance = (row.appearance_json as Record<string, unknown> | null) ?? {};
      const caps = Array.isArray(row.capability_flags) ? row.capability_flags.map(String) : [];
      return (
        appearance.assistantAudience === 'internal' ||
        row.bot_type === 'help_desk' ||
        caps.some((cap) => cap.startsWith('internal_'))
      );
    }) ?? rows[0];

  const language = detectLanguage(params.question);
  const capabilityFlags = Array.isArray(bot?.capability_flags) ? bot.capability_flags.map(String) : [];
  const appearance = (bot?.appearance_json as Record<string, unknown> | null) ?? {};
  const assistantAudience = appearance.assistantAudience === 'internal' ? 'internal' : 'customer';
  const [{ contextText }, businessContext, resolved, helpdeskActions] = await Promise.all([
    retrieveContext(params.companyId, (bot?.id as string) ?? null, params.question, 6, undefined, assistantAudience),
    getCachedBusinessContext(params.companyId),
    getChatProviderAsync(),
    hasHelpdeskRuntime(capabilityFlags, assistantAudience)
      ? listEnabledHelpdeskActions(params.companyId)
      : Promise.resolve([]),
  ]);

  const messages = buildMessages({
    systemPrompt: (bot?.system_prompt as string) ?? null,
    businessContext,
    contextText,
    helpdeskActionCatalog: formatHelpdeskActionCatalog(helpdeskActions),
    summary: null,
    history: [],
    language,
  });
  messages.push({ role: 'user', content: params.question });

  const toolSchemas = getToolSchemas(capabilityFlags, assistantAudience);
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
        botId: (bot?.id as string | undefined) ?? null,
        conversationId: null,
        language,
      },
      temperature: 0.2,
    });
    return { answer: result.text || 'No answer.' };
  }

  const res = await resolved.provider.complete({
    model: resolved.model,
    messages,
    temperature: 0.3,
    maxTokens: 500,
  });
  return { answer: res.text || 'No answer.' };
}
