import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret } from '@/lib/crypto';
import { getJson } from '@/lib/channels/http';
import { logger } from '@/lib/logger';

export interface IntentRecord {
  id: string;
  name: string;
  examples: string[];
}

export interface IntentMatch {
  name: string;
  confidence: number;
  provider: 'builtin' | 'wit' | 'intnt';
}

/**
 * Intent classification for flow triggers.
 *
 * The built-in classifier is deliberately not an LLM call: trigger matching runs
 * on every inbound message on every channel, so it has to be free and finish in
 * microseconds. It scores the message against each intent's example phrases with
 * a token-overlap similarity, which is what a small curated example set needs.
 * Companies that want a trained model point the same interface at wit.ai or
 * INTNT.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'and', 'or', 'in', 'on', 'for',
  'with', 'my', 'i', 'you', 'me', 'do', 'does', 'did', 'can', 'could', 'would', 'please', 'want',
  'need', 'how', 'what', 'when', 'where', 'this', 'that', 'it', 'at', 'from', 'have', 'has',
]);

/** Lowercase, strip punctuation, drop stopwords. Arabic tokens pass through. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard-style overlap weighted towards covering the example's own words. */
export function similarity(messageTokens: string[], exampleTokens: string[]): number {
  if (messageTokens.length === 0 || exampleTokens.length === 0) return 0;
  const message = new Set(messageTokens);
  let shared = 0;
  for (const token of new Set(exampleTokens)) if (message.has(token)) shared += 1;
  const exampleSize = new Set(exampleTokens).size;
  const union = new Set([...messageTokens, ...exampleTokens]).size;
  // Average of "how much of the example did we hit" and plain Jaccard, so a long
  // message does not dilute a short, precise example.
  return (shared / exampleSize + shared / union) / 2;
}

export const BUILTIN_INTENT_THRESHOLD = 0.34;

/** Score a message against a set of intents locally. */
export function classifyBuiltin(text: string, intents: IntentRecord[]): IntentMatch | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  let best: IntentMatch | null = null;
  for (const intent of intents) {
    for (const example of intent.examples) {
      const score = similarity(tokens, tokenize(example));
      if (!best || score > best.confidence) best = { name: intent.name, confidence: score, provider: 'builtin' };
    }
  }
  return best && best.confidence >= BUILTIN_INTENT_THRESHOLD ? best : null;
}

interface NluSettings {
  provider: 'builtin' | 'wit' | 'intnt';
  token: string | null;
  settings: Record<string, unknown>;
}

async function loadNluSettings(companyId: string): Promise<NluSettings> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('nlu_settings')
    .select('provider,token_encrypted,settings_json')
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return { provider: 'builtin', token: null, settings: {} };
  const row = data as { provider?: string; token_encrypted?: string | null; settings_json?: Record<string, unknown> };
  let token: string | null = null;
  if (row.token_encrypted) {
    try {
      token = decryptSecret(row.token_encrypted);
    } catch {
      token = null;
    }
  }
  const provider = row.provider === 'wit' || row.provider === 'intnt' ? row.provider : 'builtin';
  return { provider, token, settings: row.settings_json ?? {} };
}

export async function loadIntents(companyId: string, botId?: string | null): Promise<IntentRecord[]> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from('bot_intents')
    .select('id,name,examples,bot_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(200);
  const rows = (data ?? []) as Array<{ id: string; name: string; examples: string[] | null; bot_id: string | null }>;
  // An intent with no bot is company-wide; one bound to a bot only applies there.
  return rows
    .filter((r) => !r.bot_id || !botId || r.bot_id === botId)
    .map((r) => ({ id: r.id, name: r.name, examples: r.examples ?? [] }));
}

async function classifyWit(text: string, token: string): Promise<IntentMatch | null> {
  const url = `https://api.wit.ai/message?v=20240101&q=${encodeURIComponent(text.slice(0, 280))}`;
  const res = await getJson<{ intents?: Array<{ name?: string; confidence?: number }> }>(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const top = res.body?.intents?.[0];
  if (!res.ok || !top?.name) return null;
  return { name: top.name, confidence: top.confidence ?? 0, provider: 'wit' };
}

async function classifyIntnt(
  text: string,
  token: string,
  settings: Record<string, unknown>,
): Promise<IntentMatch | null> {
  const endpoint = (settings.endpoint as string) || 'https://api.intnt.ai/v1/classify';
  const res = await getJson<{ intent?: string; name?: string; confidence?: number; score?: number }>(
    `${endpoint}?q=${encodeURIComponent(text.slice(0, 280))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const name = res.body?.intent ?? res.body?.name;
  if (!res.ok || !name) return null;
  return { name, confidence: res.body?.confidence ?? res.body?.score ?? 0, provider: 'intnt' };
}

/**
 * Classify a message for this company. Falls back to the built-in classifier
 * whenever an external provider is unconfigured or unreachable — a flaky NLU
 * vendor must never stop the bot from answering.
 */
export async function classifyIntent(params: {
  companyId: string;
  botId?: string | null;
  text: string;
  /** Pass pre-loaded intents to avoid a second query on the hot path. */
  intents?: IntentRecord[];
}): Promise<IntentMatch | null> {
  const text = params.text.trim();
  if (!text) return null;

  const [settings, intents] = await Promise.all([
    loadNluSettings(params.companyId),
    params.intents ? Promise.resolve(params.intents) : loadIntents(params.companyId, params.botId),
  ]);
  if (intents.length === 0 && settings.provider === 'builtin') return null;

  if (settings.provider !== 'builtin' && settings.token) {
    try {
      const remote =
        settings.provider === 'wit'
          ? await classifyWit(text, settings.token)
          : await classifyIntnt(text, settings.token, settings.settings);
      const minConfidence = Number(settings.settings.minConfidence ?? 0.6);
      if (remote && remote.confidence >= minConfidence) {
        // Only accept an intent this company actually defined, so a stray label
        // from the vendor cannot trigger an unrelated flow.
        if (intents.length === 0 || intents.some((i) => i.name === remote.name)) return remote;
      }
    } catch (err) {
      logger.warn('External NLU failed; falling back to the built-in classifier', {
        provider: settings.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return classifyBuiltin(text, intents);
}
