import type { AIProvider, ChatMessage, TokenUsage } from '@/lib/ai/types';
import { wrapUntrusted } from '@/lib/ai/safety';

/**
 * Query rewriting (retrieval optimization).
 *
 * The visitor's raw message is often a poor search query: follow-ups ("and the
 * blue one?"), vague fragments ("shipping?"), dialect/Arabizi spelling, or two
 * questions at once. This module rewrites the latest message — using recent
 * history to resolve pronouns — into 1–3 standalone, keyword-rich search
 * queries before retrieval. Falls back to the raw message on any failure.
 */

const DEICTIC_RE =
  /\b(it|its|they|them|this|that|these|those|the one|the same|هذا|هذه|ذلك|هذي|هاي|نفسه|نفسها)\b/i;

/**
 * Only rewrite when it actually helps — follow-ups, short/vague messages, or
 * pronoun references. Self-contained questions are searched as-is (no latency
 * or token cost added).
 */
export function needsRewrite(message: string, hasHistory: boolean): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  if (hasHistory && words <= 12) return true;
  if (words < 6) return true;
  if (DEICTIC_RE.test(message)) return true;
  return false;
}

function parseQueries(raw: string, fallback: string): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(arr)) {
        const queries = arr
          .map((q) => (typeof q === 'string' ? q.trim() : ''))
          .filter((q) => q.length >= 2);
        const deduped = Array.from(new Set(queries)).slice(0, 3);
        if (deduped.length) return deduped;
      }
    } catch {
      /* fall through */
    }
  }
  return [fallback];
}

export async function rewriteQuery(params: {
  message: string;
  history: ChatMessage[];
  provider: AIProvider;
  model: string;
  signal?: AbortSignal;
}): Promise<{ queries: string[]; usage: TokenUsage | null }> {
  const message = params.message.trim().slice(0, 800);
  // Compact transcript of the last few turns to resolve references.
  const transcript = params.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
    .join('\n')
    .slice(0, 1500);

  const system =
    'You rewrite a customer\'s latest message into search queries for retrieving from a business knowledge base. ' +
    'Use the conversation to resolve pronouns and follow-ups so each query stands alone. ' +
    'Make queries keyword-rich and in the same language as the message. ' +
    'If the message covers multiple topics, output one query per topic (max 3). ' +
    'Reply with ONLY a JSON array of strings, e.g. ["..."]. No other text.';

  const user = `${transcript ? `Conversation:\n${wrapUntrusted('HISTORY', transcript)}\n\n` : ''}Latest message:\n${wrapUntrusted('MESSAGE', message)}`;

  try {
    let usage: TokenUsage | null = null;
    const result = await params.provider.complete({
      model: params.model,
      temperature: 0,
      maxTokens: 160,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      onUsage: (u) => {
        usage = u;
      },
      signal: params.signal,
    });
    return { queries: parseQueries(result.text, message), usage };
  } catch {
    return { queries: [message], usage: null };
  }
}
