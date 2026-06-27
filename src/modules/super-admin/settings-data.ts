import { createSupabaseServiceClient } from '@/lib/db/server';

export interface PlatformSettingsView {
  ai: {
    chatProvider: string;
    chatModel: string;
    advancedChatModel: string;
    embeddingProvider: string;
    embeddingModel: string;
    hasOpenaiKey: boolean;
    hasAnthropicKey: boolean;
    hasGeminiKey: boolean;
    hasDeepseekKey: boolean;
    hasGrokKey: boolean;
  };
  email: {
    provider: string;
    enabled: boolean;
    fromEmail: string;
    fromName: string;
    replyTo: string;
    hasResendKey: boolean;
    smtpHost: string;
    smtpPort: string;
    smtpUsername: string;
    hasSmtpPassword: boolean;
    smtpSecure: boolean;
  };
  realtime: {
    provider: string;
    customWsUrl: string;
  };
  stripe: {
    enabled: boolean;
    publishableKey: string;
    hasSecretKey: boolean;
    hasWebhookSecret: boolean;
  };
  events: Array<{
    id: string;
    settingKey: string | null;
    eventType: string;
    createdAt: string;
    actorEmail: string | null;
  }>;
}

async function readSettingsMap(): Promise<Map<string, { value: unknown; secret: boolean }>> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb.from('platform_settings').select('key,value_json,is_secret');
  return new Map(
    (data ?? []).map((row) => [
      row.key as string,
      { value: row.is_secret ? null : row.value_json, secret: Boolean(row.is_secret) },
    ]),
  );
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);

export async function getPlatformSettingsView(): Promise<PlatformSettingsView> {
  const map = await readSettingsMap();
  const get = (key: string) => map.get(key)?.value;
  const hasSecret = (key: string) => Boolean(map.get(key)?.secret);

  const sb = createSupabaseServiceClient();
  const { data: events } = await sb
    .from('platform_setting_events')
    .select('id,setting_key,event_type,created_at, users(email)')
    .order('created_at', { ascending: false })
    .limit(12);

  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const rec = (v: unknown): Record<string, unknown> => (one(v) ?? {}) as Record<string, unknown>;

  return {
    ai: {
      chatProvider: str(get('ai.chat_provider'), 'openai'),
      chatModel: str(get('ai.chat_model'), 'gpt-4o-mini'),
      advancedChatModel: str(get('ai.advanced_chat_model'), 'gpt-4o'),
      embeddingProvider: str(get('ai.embedding_provider'), 'builtin'),
      embeddingModel: str(get('ai.embedding_model'), 'builtin'),
      hasOpenaiKey: hasSecret('ai.openai_api_key'),
      hasAnthropicKey: hasSecret('ai.anthropic_api_key'),
      hasGeminiKey: hasSecret('ai.gemini_api_key'),
      hasDeepseekKey: hasSecret('ai.deepseek_api_key'),
      hasGrokKey: hasSecret('ai.grok_api_key'),
    },
    email: {
      provider: str(get('email.provider'), 'disabled'),
      enabled: bool(get('email.enabled'), false),
      fromEmail: str(get('email.from_email')),
      fromName: str(get('email.from_name'), 'AI Assistant'),
      replyTo: str(get('email.reply_to')),
      hasResendKey: hasSecret('email.resend_api_key'),
      smtpHost: str(get('email.smtp_host')),
      smtpPort: get('email.smtp_port') == null ? '' : String(get('email.smtp_port')),
      smtpUsername: str(get('email.smtp_username')),
      hasSmtpPassword: hasSecret('email.smtp_password'),
      smtpSecure: bool(get('email.smtp_secure'), true),
    },
    realtime: {
      provider: str(get('realtime.provider'), 'supabase'),
      customWsUrl: str(get('realtime.custom_ws_url')),
    },
    stripe: {
      enabled: bool(get('stripe.enabled'), false),
      publishableKey: str(get('stripe.publishable_key')),
      hasSecretKey: hasSecret('stripe.secret_key'),
      hasWebhookSecret: hasSecret('stripe.webhook_secret'),
    },
    events: ((events ?? []) as Array<Record<string, unknown>>).map((event) => ({
      id: event.id as string,
      settingKey: (event.setting_key as string) ?? null,
      eventType: event.event_type as string,
      createdAt: event.created_at as string,
      actorEmail: (rec(event.users).email as string) ?? null,
    })),
  };
}
