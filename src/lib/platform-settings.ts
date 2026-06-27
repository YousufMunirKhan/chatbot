import { createSupabaseServiceClient } from '@/lib/db/server';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface PlatformAiSettings {
  chatProvider: string;
  chatModel: string;
  advancedChatModel: string;
  embeddingProvider: string;
  embeddingModel: string;
  rerankProvider: 'cohere' | 'voyage' | 'none';
  rerankModel: string;
  /** API keys keyed by their platform_settings key (e.g. 'ai.openai_api_key'). */
  keys: Record<string, string | null>;
  // Back-compat named accessors (used by rerank).
  cohereApiKey: string | null;
  voyageApiKey: string | null;
}

// Every provider key we resolve (settings → env fallback).
const KEY_SETTINGS: Array<{ setting: string; env: string }> = [
  { setting: 'ai.openai_api_key', env: 'OPENAI_API_KEY' },
  { setting: 'ai.anthropic_api_key', env: 'ANTHROPIC_API_KEY' },
  { setting: 'ai.gemini_api_key', env: 'GEMINI_API_KEY' },
  { setting: 'ai.deepseek_api_key', env: 'DEEPSEEK_API_KEY' },
  { setting: 'ai.grok_api_key', env: 'GROK_API_KEY' },
  { setting: 'ai.cohere_api_key', env: 'COHERE_API_KEY' },
  { setting: 'ai.voyage_api_key', env: 'VOYAGE_API_KEY' },
];

// AI settings change rarely but are read several times PER chat message. Cache
// them in-memory (short TTL) and read all keys in ONE query — turns ~50 queries
// per message into ~0, the single biggest DB-load win for scaling to many bots.
const AI_SETTINGS_TTL_MS = 30_000;
let aiSettingsCache: { value: PlatformAiSettings; expiresAt: number } | null = null;

/** Bust the settings cache so a Save in the UI applies immediately. */
export function invalidatePlatformSettingsCache(): void {
  aiSettingsCache = null;
}

async function getSettingsBulk(keys: string[]): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('platform_settings')
      .select('key,value_json,is_secret')
      .in('key', keys);
    for (const row of (data ?? []) as Array<{
      key: string;
      value_json: unknown;
      is_secret: boolean;
    }>) {
      let v = row.value_json;
      if (row.is_secret && typeof v === 'string') {
        try {
          v = decryptSecret(v);
        } catch {
          v = null;
        }
      }
      map.set(row.key, v);
    }
  } catch (err) {
    logger.warn('getSettingsBulk failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return map;
}

export interface PlatformEmailSettings {
  provider: 'smtp' | 'resend' | 'disabled';
  enabled: boolean;
  fromEmail: string | null;
  fromName: string | null;
  replyTo: string | null;
  resendApiKey: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
}

export interface PlatformStripeSettings {
  publishableKey: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
  enabled: boolean;
}

async function getSetting<T>(key: string): Promise<T | null> {
  try {
    const sb = createSupabaseServiceClient();
    const { data } = await sb
      .from('platform_settings')
      .select('value_json,is_secret')
      .eq('key', key)
      .maybeSingle();
    if (!data) return null;
    const raw = data.value_json as unknown;
    if (data.is_secret && typeof raw === 'string') {
      return decryptSecret(raw) as T;
    }
    return raw as T;
  } catch (err) {
    logger.warn('Failed to read platform setting', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function upsertPlatformSetting(params: {
  key: string;
  value: unknown;
  isSecret?: boolean;
  updatedBy?: string | null;
}): Promise<void> {
  const sb = createSupabaseServiceClient();
  await sb.from('platform_settings').upsert(
    {
      key: params.key,
      value_json: params.isSecret ? encryptSecret(String(params.value ?? '')) : params.value,
      is_secret: Boolean(params.isSecret),
      updated_by: params.updatedBy ?? null,
    },
    { onConflict: 'key' },
  );
  invalidatePlatformSettingsCache();
}

export async function getPlatformAiSettings(): Promise<PlatformAiSettings> {
  const now = Date.now();
  if (aiSettingsCache && aiSettingsCache.expiresAt > now) return aiSettingsCache.value;

  const env = serverEnv() as unknown as Record<string, string | undefined>;
  // ONE query for every setting we need (was ~14 separate queries).
  const scalarKeys = [
    'ai.chat_provider',
    'ai.chat_model',
    'ai.advanced_chat_model',
    'ai.embedding_provider',
    'ai.embedding_model',
    'ai.rerank_provider',
    'ai.rerank_model',
  ];
  const map = await getSettingsBulk([...scalarKeys, ...KEY_SETTINGS.map((k) => k.setting)]);
  const get = (k: string) => map.get(k) as string | undefined;

  const keys = Object.fromEntries(
    KEY_SETTINGS.map((k) => [k.setting, get(k.setting) ?? env[k.env] ?? null]),
  ) as Record<string, string | null>;

  const value: PlatformAiSettings = {
    chatProvider: get('ai.chat_provider') ?? env.DEFAULT_CHAT_PROVIDER ?? 'openai',
    chatModel: get('ai.chat_model') ?? env.DEFAULT_CHAT_MODEL ?? 'gpt-4o-mini',
    advancedChatModel: get('ai.advanced_chat_model') ?? env.DEFAULT_ADVANCED_CHAT_MODEL ?? 'gpt-4o',
    embeddingProvider: get('ai.embedding_provider') ?? 'builtin',
    embeddingModel: get('ai.embedding_model') ?? 'builtin',
    rerankProvider:
      (get('ai.rerank_provider') as PlatformAiSettings['rerankProvider']) ??
      (env.DEFAULT_RERANK_PROVIDER as PlatformAiSettings['rerankProvider']) ??
      'cohere',
    rerankModel: get('ai.rerank_model') ?? env.DEFAULT_RERANK_MODEL ?? 'rerank-multilingual-v3.0',
    keys,
    cohereApiKey: keys['ai.cohere_api_key'] ?? null,
    voyageApiKey: keys['ai.voyage_api_key'] ?? null,
  };
  aiSettingsCache = { value, expiresAt: now + AI_SETTINGS_TTL_MS };
  return value;
}

export async function getPlatformEmailSettings(): Promise<PlatformEmailSettings> {
  const env = serverEnv();
  const [
    provider,
    enabled,
    fromEmail,
    fromName,
    replyTo,
    resendApiKey,
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    smtpSecure,
  ] = await Promise.all([
    getSetting<string>('email.provider'),
    getSetting<boolean>('email.enabled'),
    getSetting<string>('email.from_email'),
    getSetting<string>('email.from_name'),
    getSetting<string>('email.reply_to'),
    getSetting<string>('email.resend_api_key'),
    getSetting<string>('email.smtp_host'),
    getSetting<number>('email.smtp_port'),
    getSetting<string>('email.smtp_username'),
    getSetting<string>('email.smtp_password'),
    getSetting<boolean>('email.smtp_secure'),
  ]);

  return {
    provider:
      (provider as PlatformEmailSettings['provider']) ??
      (env.RESEND_API_KEY ? 'resend' : 'disabled'),
    enabled: enabled ?? Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
    fromEmail: fromEmail ?? env.EMAIL_FROM ?? null,
    fromName: fromName ?? 'AI Assistant',
    replyTo: replyTo ?? null,
    resendApiKey: resendApiKey ?? env.RESEND_API_KEY ?? null,
    smtpHost: smtpHost ?? null,
    smtpPort: smtpPort ?? null,
    smtpUsername: smtpUsername ?? null,
    smtpPassword: smtpPassword ?? null,
    smtpSecure: smtpSecure ?? true,
  };
}

export async function getPlatformStripeSettings(): Promise<PlatformStripeSettings> {
  const env = serverEnv();
  const [enabled, publishableKey, secretKey, webhookSecret] = await Promise.all([
    getSetting<boolean>('stripe.enabled'),
    getSetting<string>('stripe.publishable_key'),
    getSetting<string>('stripe.secret_key'),
    getSetting<string>('stripe.webhook_secret'),
  ]);
  return {
    enabled: enabled ?? Boolean(secretKey ?? env.STRIPE_SECRET_KEY),
    publishableKey: publishableKey ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
    secretKey: secretKey ?? env.STRIPE_SECRET_KEY ?? null,
    webhookSecret: webhookSecret ?? env.STRIPE_WEBHOOK_SECRET ?? null,
  };
}
