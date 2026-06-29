import type {
  AIProvider,
  ChatCompletionOptions,
  ChatCompletionResult,
  EmbeddingProvider,
  TokenUsage,
} from '@/lib/ai/types';
import { CACHE_BREAKPOINT } from '@/lib/ai/types';
import { fetchWithRetry } from '@/lib/ai/http';

/**
 * Google Gemini adapter (Generative Language API, API-key auth). Different shape
 * from OpenAI/Anthropic: system goes in `systemInstruction`, turns use roles
 * 'user'/'model'. Tool-calling is not wired here yet — Gemini uses the plain
 * chat path (RAG + business context still apply).
 */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function toGeminiContents(options: ChatCompletionOptions) {
  const system = options.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
    .split(CACHE_BREAKPOINT)
    .join('\n\n');
  const turns = options.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content }));
  // Gemini needs the first turn to be 'user' and alternating roles.
  const merged: Array<{ role: string; content: string }> = [];
  for (const t of turns) {
    if (merged.length === 0 && t.role !== 'user') continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else merged.push({ role: t.role, content: t.content });
  }
  return {
    system,
    contents: merged.map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
  };
}

export function createGeminiProvider(apiKey: string): AIProvider {
  return {
    name: 'gemini',
    async complete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
      const { system, contents } = toGeminiContents(options);
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/models/${options.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents,
            generationConfig: { maxOutputTokens: options.maxTokens ?? 800, temperature: options.temperature },
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? '')
        .join('');
      const usage: TokenUsage = {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      };
      options.onUsage?.(usage);
      return { text, usage, model: options.model, provider: 'gemini' };
    },
    async *stream(options: ChatCompletionOptions): AsyncIterable<string> {
      const { system, contents } = toGeminiContents(options);
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/models/${options.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents,
            generationConfig: { maxOutputTokens: options.maxTokens ?? 800, temperature: options.temperature },
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok || !res.body) throw new Error(`Gemini stream error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inTok = 0;
      let outTok = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const json = JSON.parse(trimmed.slice(5).trim());
            const parts = json.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) if (p.text) yield p.text as string;
            if (json.usageMetadata) {
              inTok = json.usageMetadata.promptTokenCount ?? inTok;
              outTok = json.usageMetadata.candidatesTokenCount ?? outTok;
            }
          } catch {
            /* ignore */
          }
        }
      }
      options.onUsage?.({ inputTokens: inTok, outputTokens: outTok });
    },
  };
}

/** Gemini embeddings (gemini-embedding-001), forced to 1536 dims to match the DB. */
export function createGeminiEmbeddingProvider(apiKey: string): EmbeddingProvider {
  return {
    name: 'gemini',
    async embed(texts: string[], model: string): Promise<{ vectors: number[][]; usage: TokenUsage }> {
      const res = await fetchWithRetry(`${GEMINI_BASE}/models/${model}:batchEmbedContents?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: `models/${model}`,
            content: { parts: [{ text: t }] },
            outputDimensionality: 1536,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Gemini embeddings error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      return {
        vectors: (json.embeddings ?? []).map((e: { values: number[] }) => e.values),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
