/**
 * AI provider abstraction (Module 9 + Developer Rule: "AI provider must be
 * switchable"). These interfaces let the backend swap OpenAI / Anthropic /
 * Voyage / Cohere from settings WITHOUT changing the AI engine.
 *
 * Concrete adapters live next to this file (e.g. `openai.ts`, `anthropic.ts`)
 * and are selected at runtime by `getChatProvider()` / `getEmbeddingProvider()`
 * / `getRerankProvider()` based on platform/company/bot settings.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Stream tokens via SSE to the widget (Module 8 / Module 9). */
  stream?: boolean;
  /**
   * Real token usage reported by the provider when available (Issue #15).
   * Providers invoke this after a (streamed) completion so the caller logs
   * accurate cost instead of a char-length estimate.
   */
  onUsage?: (usage: TokenUsage) => void;
  /** Abort signal (timeouts / client disconnect) propagated to the provider. */
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatCompletionResult {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: TokenUsage;
  model: string;
  provider: string;
}

/** Main chat model abstraction. */
export interface AIProvider {
  readonly name: string;
  complete(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  stream(options: ChatCompletionOptions): AsyncIterable<string>;
}

/** Multilingual embeddings abstraction (Arabic + English). */
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[], model: string): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}

/** Reranker abstraction (Voyage / Cohere / OpenAI-compatible). */
export interface RerankProvider {
  readonly name: string;
  rerank(
    query: string,
    documents: string[],
    model: string,
    topK?: number,
  ): Promise<Array<{ index: number; score: number }>>;
}
