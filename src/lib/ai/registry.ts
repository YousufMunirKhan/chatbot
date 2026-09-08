/**
 * AI provider registry — the single source of truth for which providers and
 * models the platform offers. Adding a provider = one entry here; the settings
 * UI, the resolver, and the model dropdowns all read from this.
 *
 * apiType drives which adapter is used:
 *   'openai'    → OpenAI-compatible (OpenAI, DeepSeek, xAI Grok) via baseUrl
 *   'anthropic' → Claude
 *   'gemini'    → Google Gemini
 */
export type ChatApiType = 'openai' | 'anthropic' | 'gemini';

export interface ChatProviderDef {
  id: string;
  label: string;
  apiType: ChatApiType;
  /** Base URL for OpenAI-compatible providers. */
  baseUrl?: string;
  /** platform_settings key holding the (encrypted) API key. */
  keySetting: string;
  /** Env var fallback. */
  envKey: string;
  models: { latest: string[]; older: string[] };
  defaultChat: string;
  defaultAdvanced: string;
}

export const CHAT_PROVIDERS: ChatProviderDef[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    apiType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keySetting: 'ai.openai_api_key',
    envKey: 'OPENAI_API_KEY',
    models: { latest: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'], older: ['gpt-4-turbo', 'gpt-3.5-turbo'] },
    defaultChat: 'gpt-4o-mini',
    defaultAdvanced: 'gpt-4o',
  },
  {
    id: 'anthropic',
    label: 'Claude / Anthropic',
    apiType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keySetting: 'ai.anthropic_api_key',
    envKey: 'ANTHROPIC_API_KEY',
    models: {
      latest: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      older: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    },
    defaultChat: 'claude-haiku-4-5-20251001',
    defaultAdvanced: 'claude-sonnet-4-6',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    apiType: 'gemini',
    keySetting: 'ai.gemini_api_key',
    envKey: 'GEMINI_API_KEY',
    models: { latest: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'], older: ['gemini-1.5-pro', 'gemini-1.5-flash'] },
    defaultChat: 'gemini-2.5-flash',
    defaultAdvanced: 'gemini-2.5-pro',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiType: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keySetting: 'ai.deepseek_api_key',
    envKey: 'DEEPSEEK_API_KEY',
    models: { latest: ['deepseek-chat', 'deepseek-reasoner'], older: [] },
    defaultChat: 'deepseek-chat',
    defaultAdvanced: 'deepseek-reasoner',
  },
  {
    id: 'grok',
    label: 'xAI Grok',
    apiType: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keySetting: 'ai.grok_api_key',
    envKey: 'GROK_API_KEY',
    models: { latest: ['grok-4', 'grok-3', 'grok-3-mini'], older: [] },
    defaultChat: 'grok-3-mini',
    defaultAdvanced: 'grok-4',
  },
];

export interface EmbedProviderDef {
  id: string;
  label: string;
  apiType: 'mock' | 'openai' | 'gemini';
  keySetting?: string;
  envKey?: string;
  models: string[];
  defaultModel: string;
}

/**
 * The width of every vector this product stores, fixed by the database.
 *
 * `knowledge_chunks.embedding` is `vector(1536)` (migration 0006). Postgres
 * enforces that exactly — a model returning another width does not degrade, it
 * fails the insert.
 *
 * THIS HAS ALREADY COST AN OUTAGE. The list below offers
 * `text-embedding-3-large` and somebody selected it, so every page of every
 * website import died with `expected 1536 dimensions, not 3072`, reaching the
 * customer as a bare "Application error". It went unnoticed for a day because
 * the import was unreachable in the UI and had therefore never run.
 *
 * The fix is to ALWAYS ask for this width rather than to police the model list:
 * OpenAI takes `dimensions` and Gemini takes `outputDimensionality`, and both
 * `-3-small` and `-3-large` honour it. `assertEmbeddingWidth` then catches any
 * model that cannot, naming the model and the setting to change instead of
 * leaving a Postgres error to be decoded out of a crawl loop.
 *
 * Changing this means changing the column, in a migration that also re-embeds
 * everything already stored — vectors of different widths are not comparable.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** Fail at the provider, with something a person can act on. */
export function assertEmbeddingWidth(vectors: number[][], model: string): void {
  const wrong = vectors.find((v) => v.length !== EMBEDDING_DIMENSIONS);
  if (!wrong) return;
  throw new Error(
    `Embedding model "${model}" returned ${wrong.length}-dimension vectors, but this database ` +
      `stores ${EMBEDDING_DIMENSIONS}. Change the embedding model in Super Admin → Settings → AI ` +
      `to one that produces ${EMBEDDING_DIMENSIONS} dimensions, such as text-embedding-3-small.`,
  );
}

export const EMBED_PROVIDERS: EmbedProviderDef[] = [
  { id: 'builtin', label: 'Free built-in search (no key)', apiType: 'mock', models: ['builtin'], defaultModel: 'builtin' },
  {
    id: 'openai',
    label: 'OpenAI',
    apiType: 'openai',
    keySetting: 'ai.openai_api_key',
    envKey: 'OPENAI_API_KEY',
    models: ['text-embedding-3-small', 'text-embedding-3-large'],
    defaultModel: 'text-embedding-3-small',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    apiType: 'gemini',
    keySetting: 'ai.gemini_api_key',
    envKey: 'GEMINI_API_KEY',
    models: ['gemini-embedding-001'],
    defaultModel: 'gemini-embedding-001',
  },
];

export function chatProviderById(id: string): ChatProviderDef | undefined {
  return CHAT_PROVIDERS.find((p) => p.id === id);
}
export function embedProviderById(id: string): EmbedProviderDef | undefined {
  return EMBED_PROVIDERS.find((p) => p.id === id);
}
