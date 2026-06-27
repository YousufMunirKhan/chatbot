import { serverEnv } from '@/lib/env';
import type { AIProvider, EmbeddingProvider, RerankProvider } from '@/lib/ai/types';
import { mockProvider, mockEmbeddingProvider, EMBEDDING_DIM } from './mock';
import { createOpenAIProvider, createOpenAIEmbeddingProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider, createGeminiEmbeddingProvider } from './gemini';
import { createCohereReranker, createVoyageReranker } from './rerank';
import { chatProviderById, embedProviderById, type ChatApiType } from '@/lib/ai/registry';
import { getPlatformAiSettings } from '@/lib/platform-settings';

export { EMBEDDING_DIM };

export interface ResolvedChat {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  /** Which adapter family — drives tool-loop selection in the route. */
  apiType?: ChatApiType | 'mock';
  baseUrl?: string;
}
export interface ResolvedEmbedding {
  provider: EmbeddingProvider;
  model: string;
  /** True when the deterministic mock embeddings are in use (Issue #8). */
  isMock: boolean;
}
export interface ResolvedRerank {
  provider: RerankProvider;
  model: string;
}

/**
 * Resolve the chat provider (Module 9 "AI provider must be switchable").
 * Order: configured DEFAULT_CHAT_PROVIDER if its key is present → any available
 * key → mock (so the pipeline runs with no keys in development).
 * Company/bot-level overrides plug in here via the settings system (Module 2).
 */
export function getChatProvider(): ResolvedChat {
  const env = serverEnv();
  const model = env.DEFAULT_CHAT_MODEL || 'gpt-4o-mini';

  if (env.DEFAULT_CHAT_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return { provider: createAnthropicProvider(env.ANTHROPIC_API_KEY), model, apiKey: env.ANTHROPIC_API_KEY };
  }
  if (env.DEFAULT_CHAT_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
    return { provider: createOpenAIProvider(env.OPENAI_API_KEY), model, apiKey: env.OPENAI_API_KEY };
  }
  if (env.OPENAI_API_KEY) return { provider: createOpenAIProvider(env.OPENAI_API_KEY), model, apiKey: env.OPENAI_API_KEY };
  if (env.ANTHROPIC_API_KEY) {
    return { provider: createAnthropicProvider(env.ANTHROPIC_API_KEY), model: model || 'claude-haiku-4-5-20251001', apiKey: env.ANTHROPIC_API_KEY };
  }
  return { provider: mockProvider, model: 'mock' };
}

/**
 * Resolve the selected chat provider from the registry. One provider at a time —
 * NO silent cross-vendor fallback. If the chosen provider has no key, fall back
 * to the free built-in (mock) so nothing hard-crashes.
 */
export async function getChatProviderAsync(): Promise<ResolvedChat> {
  const settings = await getPlatformAiSettings();
  const def = chatProviderById(settings.chatProvider);
  if (!def) return { provider: mockProvider, model: 'mock', apiType: 'mock' };
  const key = settings.keys[def.keySetting];
  if (!key) return { provider: mockProvider, model: 'mock', apiType: 'mock' };

  const all = [...def.models.latest, ...def.models.older];
  const model = settings.chatModel && all.includes(settings.chatModel) ? settings.chatModel : def.defaultChat;

  if (def.apiType === 'anthropic') {
    return { provider: createAnthropicProvider(key), model, apiKey: key, apiType: 'anthropic', baseUrl: def.baseUrl };
  }
  if (def.apiType === 'gemini') {
    return { provider: createGeminiProvider(key), model, apiKey: key, apiType: 'gemini' };
  }
  return { provider: createOpenAIProvider(key, def.baseUrl), model, apiKey: key, apiType: 'openai', baseUrl: def.baseUrl };
}

/** No cross-vendor fallback — a single provider is used, by design. */
export async function getFallbackChatProviderAsync(_primaryName?: string): Promise<ResolvedChat | null> {
  return null;
}

/** Resolve the embedding provider. Model must produce 1536-dim vectors. */
export function getEmbeddingProvider(): ResolvedEmbedding {
  const env = serverEnv();
  const model = env.DEFAULT_EMBEDDING_MODEL || 'text-embedding-3-small';
  if (env.OPENAI_API_KEY) return { provider: createOpenAIEmbeddingProvider(env.OPENAI_API_KEY), model, isMock: false };
  return { provider: mockEmbeddingProvider, model: 'mock', isMock: true };
}

export async function getEmbeddingProviderAsync(): Promise<ResolvedEmbedding> {
  const settings = await getPlatformAiSettings();
  const def = embedProviderById(settings.embeddingProvider);
  // Built-in (mock) is the default and needs no key.
  if (!def || def.apiType === 'mock') return { provider: mockEmbeddingProvider, model: 'mock', isMock: true };
  const key = def.keySetting ? settings.keys[def.keySetting] : null;
  if (!key) return { provider: mockEmbeddingProvider, model: 'mock', isMock: true };
  const model = settings.embeddingModel && def.models.includes(settings.embeddingModel) ? settings.embeddingModel : def.defaultModel;
  if (def.apiType === 'gemini') return { provider: createGeminiEmbeddingProvider(key), model, isMock: false };
  return { provider: createOpenAIEmbeddingProvider(key), model, isMock: false };
}

/**
 * Resolve the reranker (Issue #5). Returns null when no reranker is configured
 * or its key is absent — retrieval then falls back to the hybrid blend score.
 */
export async function getRerankProviderAsync(): Promise<ResolvedRerank | null> {
  const settings = await getPlatformAiSettings();
  if (settings.rerankProvider === 'cohere' && settings.cohereApiKey) {
    return { provider: createCohereReranker(settings.cohereApiKey), model: settings.rerankModel };
  }
  if (settings.rerankProvider === 'voyage' && settings.voyageApiKey) {
    return { provider: createVoyageReranker(settings.voyageApiKey), model: settings.rerankModel || 'rerank-2' };
  }
  return null;
}

export function isMockMode(): boolean {
  const env = serverEnv();
  return !env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY;
}

/**
 * Guard against a provider/model family mismatch (e.g. provider=Anthropic but
 * model=gpt-4o-mini, which 404s). Returns the configured model when it matches
 * the provider family, otherwise a sane same-family default.
 */
export function modelForProvider(name: 'openai' | 'anthropic', configured: string): string {
  const isOpenAIModel = /gpt|^o\d/i.test(configured);
  const isAnthropicModel = /claude/i.test(configured);
  if (name === 'openai') return isOpenAIModel ? configured : 'gpt-4o-mini';
  return isAnthropicModel ? configured : 'claude-haiku-4-5-20251001';
}
