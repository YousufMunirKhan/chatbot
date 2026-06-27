/**
 * Settings system (Module 2 "Settings Rule": everything configurable comes from
 * settings). Resolution order, most specific wins:
 *
 *   bot_settings  →  company_settings  →  platform_settings  →  env default
 *
 * This gives a single source of truth for AI provider/model, embedding provider,
 * reranker, language defaults, widget theme, lead/appointment/order config,
 * trial expiry, message limits, sync frequency, takeover rules, retention, etc.
 *
 * Implemented fully in Module 2. The signature below is the contract other
 * modules depend on.
 */
export interface SettingsScope {
  platform?: boolean;
  companyId?: string;
  botId?: string;
}

export interface ResolvedSetting<T> {
  value: T;
  source: 'bot' | 'company' | 'platform' | 'default';
}

/**
 * Resolve a single setting key across the scope chain.
 * @example const provider = await getSetting('chat_provider', { companyId, botId }, env.DEFAULT_CHAT_PROVIDER)
 */
export async function getSetting<T>(
  _key: string,
  _scope: SettingsScope,
  fallback: T,
): Promise<ResolvedSetting<T>> {
  // TODO(Module 2): read platform_settings / company_settings / bot_settings.
  return { value: fallback, source: 'default' };
}
