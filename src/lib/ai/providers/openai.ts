import type {
  AIProvider,
  ChatCompletionOptions,
  ChatCompletionResult,
  EmbeddingProvider,
  TokenUsage,
} from '@/lib/ai/types';
import { CACHE_BREAKPOINT } from '@/lib/ai/types';
import { fetchWithRetry } from '@/lib/ai/http';

const OPENAI_API = 'https://api.openai.com/v1';

// OpenAI auto-caches long stable prefixes — no markup needed; just drop the
// Anthropic-only cache marker so it never reaches the model.
function toOpenAIMessages(options: ChatCompletionOptions) {
  return options.messages.map((m) => ({
    role: m.role === 'tool' ? 'assistant' : m.role,
    content: m.content.split(CACHE_BREAKPOINT).join('\n\n'),
  }));
}

/**
 * OpenAI-compatible chat provider (fetch-based, no SDK). The same adapter serves
 * OpenAI, DeepSeek, and xAI Grok — only the base URL + key differ.
 */
export function createOpenAIProvider(apiKey: string, baseUrl = OPENAI_API): AIProvider {
  const API = baseUrl.replace(/\/$/, '');
  return {
    name: 'openai',
    async complete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
      const res = await fetchWithRetry(
        `${API}/chat/completions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            messages: toOpenAIMessages(options),
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 800,
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const usage: TokenUsage = {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
      options.onUsage?.(usage);
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage,
        model: json.model ?? options.model,
        provider: 'openai',
      };
    },
    async *stream(options: ChatCompletionOptions): AsyncIterable<string> {
      const res = await fetchWithRetry(
        `${API}/chat/completions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            messages: toOpenAIMessages(options),
            temperature: options.temperature ?? 0.3,
            max_tokens: options.maxTokens ?? 800,
            stream: true,
            // Real token usage in the final SSE chunk (Issue #15).
            stream_options: { include_usage: true },
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok || !res.body) throw new Error(`OpenAI stream error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage) {
              options.onUsage?.({
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? 0,
              });
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            /* ignore keep-alive / partial */
          }
        }
      }
    },
  };
}

/** OpenAI embeddings (1536-dim default model: text-embedding-3-small). */
export function createOpenAIEmbeddingProvider(apiKey: string): EmbeddingProvider {
  return {
    name: 'openai',
    async embed(texts: string[], model: string): Promise<{ vectors: number[][]; usage: TokenUsage }> {
      const res = await fetchWithRetry(`${OPENAI_API}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || 'text-embedding-3-small', input: texts }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return {
        vectors: json.data.map((d: { embedding: number[] }) => d.embedding),
        usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      };
    },
  };
}
