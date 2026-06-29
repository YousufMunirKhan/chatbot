import type {
  AIProvider,
  ChatCompletionOptions,
  ChatCompletionResult,
  EmbeddingProvider,
  TokenUsage,
} from '@/lib/ai/types';
import { CACHE_BREAKPOINT } from '@/lib/ai/types';

export const EMBEDDING_DIM = 1536;

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function lastUserMessage(options: ChatCompletionOptions): string {
  for (let i = options.messages.length - 1; i >= 0; i--) {
    if (options.messages[i]?.role === 'user') return options.messages[i]!.content;
  }
  return '';
}

function contextFromSystem(options: ChatCompletionOptions): string | null {
  const sys = (options.messages.find((m) => m.role === 'system')?.content ?? '').split(CACHE_BREAKPOINT).join('\n\n');
  const marker = sys.indexOf('KNOWLEDGE CONTEXT');
  if (marker === -1) return null;
  const ctx = sys.slice(marker + 'KNOWLEDGE CONTEXT'.length).trim();
  return ctx.length > 0 ? ctx : null;
}

function buildReply(options: ChatCompletionOptions): string {
  const userMsg = lastUserMessage(options);
  const ctx = contextFromSystem(options);
  if (ctx) {
    return `Based on our information: ${ctx.slice(0, 280)}${ctx.length > 280 ? '…' : ''}\n\n(Demo mode — add OPENAI_API_KEY or ANTHROPIC_API_KEY for real AI answers.)`;
  }
  return `Thanks for your message! You asked: "${userMsg.slice(0, 160)}". I don't have specific information on that yet — once knowledge or an AI provider key is added, I'll answer from your business data.\n\n(Demo mode.)`;
}

/**
 * Mock provider — used when no real AI key is configured. Lets the full chat
 * pipeline (widget → engine → stream → inbox) work end-to-end in development.
 */
export const mockProvider: AIProvider = {
  name: 'mock',
  async complete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const text = buildReply(options);
    return {
      text,
      usage: { inputTokens: approxTokens(JSON.stringify(options.messages)), outputTokens: approxTokens(text) },
      model: options.model || 'mock',
      provider: 'mock',
    };
  },
  async *stream(options: ChatCompletionOptions): AsyncIterable<string> {
    const text = buildReply(options);
    for (const word of text.split(/(\s+)/)) {
      yield word;
    }
  },
};

/** Deterministic pseudo-embeddings so vector search is structurally functional. */
export const mockEmbeddingProvider: EmbeddingProvider = {
  name: 'mock',
  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: TokenUsage }> {
    const vectors = texts.map((t) => {
      const v = new Array(EMBEDDING_DIM).fill(0);
      for (let i = 0; i < t.length; i++) {
        const code = t.charCodeAt(i);
        v[(code * 31 + i) % EMBEDDING_DIM] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
    const inputTokens = texts.reduce((s, t) => s + approxTokens(t), 0);
    return { vectors, usage: { inputTokens, outputTokens: 0 } };
  },
};
