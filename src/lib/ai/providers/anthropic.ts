import type { AIProvider, ChatCompletionOptions, ChatCompletionResult } from '@/lib/ai/types';
import { CACHE_BREAKPOINT } from '@/lib/ai/types';
import { fetchWithRetry } from '@/lib/ai/http';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/**
 * Anthropic requires the first message to be a `user` turn and roles to
 * alternate. Drop any leading assistant turns and merge consecutive same-role
 * messages so a stored AI greeting or back-to-back replies can't 400 the API.
 */
export function normalizeAnthropicTurns(
  msgs: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of msgs) {
    if (out.length === 0 && m.role !== 'user') continue; // must start with user
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/**
 * Split system messages out (Anthropic takes `system` separately) and turn the
 * CACHE_BREAKPOINT marker into prompt-cache blocks: the stable prefix is cached
 * (~90% cheaper on a hit), the volatile tail (knowledge/summary) is not.
 */
function split(options: ChatCompletionOptions) {
  const systemRaw = options.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const [stable, volatile] = systemRaw.split(CACHE_BREAKPOINT);
  const systemBlocks: SystemBlock[] = [];
  if (stable && stable.trim()) {
    systemBlocks.push({ type: 'text', text: stable, cache_control: { type: 'ephemeral' } });
  }
  if (volatile && volatile.trim()) {
    systemBlocks.push({ type: 'text', text: volatile });
  }
  const messages = normalizeAnthropicTurns(
    options.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  );
  return { system: systemBlocks.length ? systemBlocks : undefined, messages };
}

/** Anthropic (Claude) chat provider — fetch-based. */
export function createAnthropicProvider(apiKey: string): AIProvider {
  return {
    name: 'anthropic',
    async complete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
      const { system, messages } = split(options);
      const res = await fetchWithRetry(
        ANTHROPIC_API,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            system,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens ?? 800,
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const text = (json.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
      const usage = {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      };
      options.onUsage?.(usage);
      return { text, usage, model: json.model ?? options.model, provider: 'anthropic' };
    },
    async *stream(options: ChatCompletionOptions): AsyncIterable<string> {
      const { system, messages } = split(options);
      const res = await fetchWithRetry(
        ANTHROPIC_API,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            system,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens ?? 800,
            stream: true,
          }),
        },
        { signal: options.signal },
      );
      if (!res.ok || !res.body) throw new Error(`Anthropic stream error ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Anthropic reports input tokens on message_start and output tokens on
      // message_delta (Issue #15).
      let inputTokens = 0;
      let outputTokens = 0;
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
            const evt = JSON.parse(trimmed.slice(5).trim());
            if (evt.type === 'message_start') {
              inputTokens = evt.message?.usage?.input_tokens ?? 0;
            } else if (evt.type === 'content_block_delta' && evt.delta?.text) {
              yield evt.delta.text;
            } else if (evt.type === 'message_delta' && evt.usage?.output_tokens != null) {
              outputTokens = evt.usage.output_tokens;
            }
          } catch {
            /* ignore */
          }
        }
      }
      options.onUsage?.({ inputTokens, outputTokens });
    },
  };
}
