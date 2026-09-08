import { serverEnv } from '@/lib/env';
import type { AIProvider, EmbeddingProvider, RerankProvider } from '@/lib/ai/types';
import { mockProvider, mockEmbeddingProvider, EMBEDDING_DIM } from './mock';
import { createOpenAIProvider, createOpenAIEmbeddingProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider, createGeminiEmbeddingProvider } from './gemini';
import { createCohereReranker, createVoyageReranker } from './rerank';
import { chatProviderById, embedProviderById, type ChatApiType } from '@/lib/ai/registry';
import { getPlatformAiSettings } from '@/lib/platform-settings';
import { resolveModelForCompany } from '@/lib/ai/model-policy';
import type { ModelTier } from '@/modules/super-admin/plans';

export { EMBEDDING_DIM };

export interface ResolvedChat {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  /** Which adapter family — drives tool-loop selection in the route. */
  apiType?: ChatApiType | 'mock';
  baseUrl?: string;
  /** The tier `model` sits in, once a company was given to resolve against. */
  modelTier?: ModelTier;
  /** True when the plan would not reach the platform's configured model. */
  modelClamped?: boolean;
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
 *
 * PASS THE COMPANY ID. The platform setting says which model the operator wants;
 * the company's plan says which model it may have. Without a company id there is
 * nobody to clamp against and the configured model is used as-is, which is the
 * right answer for platform-level callers (the super admin's "test AI settings")
 * and the wrong one for anything answering a customer — a Starter plan on a
 * premium model costs 3.5x per reply and nothing else in the stack notices. See
 * `src/lib/ai/model-policy.ts`.
 */
export async function getChatProviderAsync(companyId?: string | null): Promise<ResolvedChat> {
  const settings = await getPlatformAiSettings();
  const def = chatProviderById(settings.chatProvider);
  if (!def) return { provider: mockProvider, model: 'mock', apiType: 'mock' };
  const key = settings.keys[def.keySetting];
  if (!key) return { provider: mockProvider, model: 'mock', apiType: 'mock' };

  const all = [...def.models.latest, ...def.models.older];
  const configured = settings.chatModel && all.includes(settings.chatModel) ? settings.chatModel : def.defaultChat;

  // The clamp. `def.defaultChat` is the registry's cheap everyday model for this
  // provider, which is exactly what a plan that cannot reach the premium tier
  // should be answered on, and it is always in the same vendor family as the key
  // we are about to send — so the substitution can never produce a 404.
  const decision = await resolveModelForCompany({
    companyId,
    requestedModel: configured,
    standardModel: def.defaultChat,
  });
  const model = decision.model;
  const tier = { modelTier: decision.tier, modelClamped: decision.clamped };

  if (def.apiType === 'anthropic') {
    return { provider: createAnthropicProvider(key), model, apiKey: key, apiType: 'anthropic', baseUrl: def.baseUrl, ...tier };
  }
  if (def.apiType === 'gemini') {
    return { provider: createGeminiProvider(key), model, apiKey: key, apiType: 'gemini', ...tier };
  }
  return { provider: createOpenAIProvider(key, def.baseUrl), model, apiKey: key, apiType: 'openai', baseUrl: def.baseUrl, ...tier };
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
