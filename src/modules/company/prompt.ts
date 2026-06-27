import { createSupabaseServiceClient } from '@/lib/db/server';
import { assembleSystemPrompt, type PromptConfig } from '@/lib/ai/prompts/assemble';

/**
 * Server helpers that persist assistant prompt configuration in `bot_settings`
 * and keep the assembled `bots.system_prompt` in sync (Module 6).
 */
type SB = ReturnType<typeof createSupabaseServiceClient>;

export async function getPromptConfig(sb: SB, botId: string): Promise<PromptConfig> {
  const { data } = await sb
    .from('bot_settings')
    .select('value_json')
    .eq('bot_id', botId)
    .eq('key', 'prompt_config')
    .maybeSingle();
  return ((data?.value_json as PromptConfig | undefined) ?? {}) as PromptConfig;
}

/** Read prompt config with a fresh service client (after ownership is verified). */
export async function loadPromptConfig(botId: string): Promise<PromptConfig> {
  return getPromptConfig(createSupabaseServiceClient(), botId);
}

/**
 * Reassemble the system prompt from the bot (type, language, capabilities),
 * the company (name), and the saved prompt config, and store it on the bot.
 * Scoped by companyId so it can never touch another tenant's bot.
 */
export async function recomputeBotPrompt(sb: SB, companyId: string, botId: string): Promise<void> {
  const { data: bot } = await sb
    .from('bots')
    .select('name,bot_type,language_default,capability_flags,appearance_json')
    .eq('company_id', companyId)
    .eq('id', botId)
    .maybeSingle();
  if (!bot) return;

  const { data: company } = await sb
    .from('companies')
    .select('name')
    .eq('id', companyId)
    .maybeSingle();

  const config = await getPromptConfig(sb, botId);
  const appearance = (bot.appearance_json as Record<string, unknown> | null) ?? {};
  const assistantAudience = appearance.assistantAudience === 'internal' ? 'internal' : 'customer';
  // Business facts are injected fresh at runtime (Issue #18) rather than baked
  // into this stored snapshot, so the assistant never answers from stale hours,
  // prices, or policies. The stored prompt is the stable persona + grounding.
  const systemPrompt = assembleSystemPrompt({
    botType: bot.bot_type as string,
    assistantAudience,
    language: bot.language_default as string,
    businessName: (company?.name as string) ?? (bot.name as string),
    capabilities: (bot.capability_flags as string[]) ?? [],
    config,
  });

  await sb
    .from('bots')
    .update({ system_prompt: systemPrompt })
    .eq('company_id', companyId)
    .eq('id', botId);
}

export async function recomputeCompanyBotPrompts(sb: SB, companyId: string): Promise<void> {
  const { data: bots } = await sb.from('bots').select('id').eq('company_id', companyId);
  for (const bot of bots ?? []) {
    await recomputeBotPrompt(sb, companyId, (bot as { id: string }).id);
  }
}
