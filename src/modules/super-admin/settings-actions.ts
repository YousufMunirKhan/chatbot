'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getChatProviderAsync } from '@/lib/ai/providers';
import { sendEmail } from '@/lib/email';
import { upsertPlatformSetting } from '@/lib/platform-settings';

export type SettingsActionState = { error?: string; ok?: boolean; message?: string };

const optText = z.preprocess((x) => (x === '' || x == null ? undefined : x), z.string().optional());

async function audit(actorId: string, action: string, metadata: Record<string, unknown> = {}) {
  const sb = createSupabaseServiceClient();
  await sb.from('audit_logs').insert({
    actor_user_id: actorId,
    action,
    target_type: 'platform_settings',
    metadata_json: metadata,
  });
}

async function settingEvent(
  actorId: string,
  eventType: string,
  settingKey: string | null,
  metadata: Record<string, unknown> = {},
) {
  const sb = createSupabaseServiceClient();
  await sb.from('platform_setting_events').insert({
    actor_user_id: actorId,
    event_type: eventType,
    setting_key: settingKey,
    metadata_json: metadata,
  });
}

const aiSchema = z.object({
  chatProvider: z.string().min(1),
  chatModel: z.string().min(1, 'Chat model is required'),
  advancedChatModel: z.string().min(1, 'Advanced model is required'),
  embeddingProvider: z.string().min(1),
  embeddingModel: z.string().min(1, 'Embedding model is required'),
  openaiApiKey: optText,
  anthropicApiKey: optText,
  geminiApiKey: optText,
  deepseekApiKey: optText,
  grokApiKey: optText,
});

const KEY_FIELDS: Array<{
  field: 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey' | 'deepseekApiKey' | 'grokApiKey';
  setting: string;
}> = [
  { field: 'openaiApiKey', setting: 'ai.openai_api_key' },
  { field: 'anthropicApiKey', setting: 'ai.anthropic_api_key' },
  { field: 'geminiApiKey', setting: 'ai.gemini_api_key' },
  { field: 'deepseekApiKey', setting: 'ai.deepseek_api_key' },
  { field: 'grokApiKey', setting: 'ai.grok_api_key' },
];

export async function updateAiSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = aiSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  try {
    await Promise.all([
      upsertPlatformSetting({
        key: 'ai.chat_provider',
        value: v.chatProvider,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({ key: 'ai.chat_model', value: v.chatModel, updatedBy: admin.userId }),
      upsertPlatformSetting({
        key: 'ai.advanced_chat_model',
        value: v.advancedChatModel,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'ai.embedding_provider',
        value: v.embeddingProvider,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'ai.embedding_model',
        value: v.embeddingModel,
        updatedBy: admin.userId,
      }),
      ...KEY_FIELDS.filter((k) => v[k.field]).map((k) =>
        upsertPlatformSetting({
          key: k.setting,
          value: v[k.field],
          isSecret: true,
          updatedBy: admin.userId,
        }),
      ),
    ]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save AI settings' };
  }

  await audit(admin.userId, 'platform.ai_settings.updated', {
    chatProvider: v.chatProvider,
    chatModel: v.chatModel,
    embeddingProvider: v.embeddingProvider,
    embeddingModel: v.embeddingModel,
    openaiKeyUpdated: Boolean(v.openaiApiKey),
    anthropicKeyUpdated: Boolean(v.anthropicApiKey),
  });
  await settingEvent(admin.userId, 'ai_settings_updated', 'ai.*', {
    chatProvider: v.chatProvider,
    openaiKeyUpdated: Boolean(v.openaiApiKey),
    anthropicKeyUpdated: Boolean(v.anthropicApiKey),
  });
  revalidatePath('/super-admin/settings');
  return { ok: true, message: 'AI settings saved.' };
}

const emailSchema = z.object({
  provider: z.enum(['disabled', 'resend', 'smtp']),
  enabled: z.preprocess((x) => x === 'on', z.boolean()),
  fromEmail: optText,
  fromName: optText,
  replyTo: optText,
  resendApiKey: optText,
  smtpHost: optText,
  smtpPort: z.preprocess(
    (x) => (x === '' || x == null ? undefined : x),
    z.coerce.number().int().positive().optional(),
  ),
  smtpUsername: optText,
  smtpPassword: optText,
  smtpSecure: z.preprocess((x) => x === 'on', z.boolean()),
});

export async function updateEmailSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  try {
    await Promise.all([
      upsertPlatformSetting({ key: 'email.provider', value: v.provider, updatedBy: admin.userId }),
      upsertPlatformSetting({ key: 'email.enabled', value: v.enabled, updatedBy: admin.userId }),
      upsertPlatformSetting({
        key: 'email.from_email',
        value: v.fromEmail ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.from_name',
        value: v.fromName ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.reply_to',
        value: v.replyTo ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.smtp_host',
        value: v.smtpHost ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.smtp_port',
        value: v.smtpPort ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.smtp_username',
        value: v.smtpUsername ?? null,
        updatedBy: admin.userId,
      }),
      upsertPlatformSetting({
        key: 'email.smtp_secure',
        value: v.smtpSecure,
        updatedBy: admin.userId,
      }),
      v.resendApiKey
        ? upsertPlatformSetting({
            key: 'email.resend_api_key',
            value: v.resendApiKey,
            isSecret: true,
            updatedBy: admin.userId,
          })
        : Promise.resolve(),
      v.smtpPassword
        ? upsertPlatformSetting({
            key: 'email.smtp_password',
            value: v.smtpPassword,
            isSecret: true,
            updatedBy: admin.userId,
          })
        : Promise.resolve(),
    ]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save email settings' };
  }

  await audit(admin.userId, 'platform.email_settings.updated', {
    provider: v.provider,
    enabled: v.enabled,
    resendKeyUpdated: Boolean(v.resendApiKey),
    smtpPasswordUpdated: Boolean(v.smtpPassword),
  });
  await settingEvent(admin.userId, 'email_settings_updated', 'email.*', {
    provider: v.provider,
    enabled: v.enabled,
    secretUpdated: Boolean(v.resendApiKey || v.smtpPassword),
  });
  revalidatePath('/super-admin/settings');
  return { ok: true, message: 'Email settings saved.' };
}

export async function testAiSettingsAction(
  _prev: SettingsActionState,
  _formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  try {
    const { provider, model } = await getChatProviderAsync();
    const result = await provider.complete({
      model,
      messages: [
        { role: 'system', content: 'Reply with one short sentence.' },
        { role: 'user', content: 'Say that the AI settings test is working.' },
      ],
      maxTokens: 40,
    });
    await settingEvent(admin.userId, 'ai_test_succeeded', 'ai.chat_provider', {
      model,
      provider: provider.name,
    });
    return { ok: true, message: result.text || 'AI settings test completed.' };
  } catch (err) {
    await settingEvent(admin.userId, 'ai_test_failed', 'ai.chat_provider', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: err instanceof Error ? err.message : 'AI settings test failed' };
  }
}

const testEmailSchema = z.object({ testEmail: z.string().email('Valid email required') });

export async function sendTestEmailAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = testEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const result = await sendEmail({
    to: parsed.data.testEmail,
    subject: 'Chatbot platform email test',
    html: '<p>Your platform email settings are working.</p>',
  });
  await settingEvent(
    admin.userId,
    result.sent ? 'email_test_succeeded' : 'email_test_failed',
    'email.provider',
    {
      to: parsed.data.testEmail,
    },
  );
  return result.sent
    ? { ok: true, message: 'Test email sent.' }
    : { error: 'Email was not sent. Check provider settings.' };
}

const realtimeSchema = z.object({
  provider: z.enum(['supabase', 'custom_websocket']),
  customWsUrl: optText,
});

export async function updateRealtimeSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = realtimeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;
  await Promise.all([
    upsertPlatformSetting({ key: 'realtime.provider', value: v.provider, updatedBy: admin.userId }),
    upsertPlatformSetting({
      key: 'realtime.custom_ws_url',
      value: v.customWsUrl ?? null,
      updatedBy: admin.userId,
    }),
  ]);
  await settingEvent(admin.userId, 'realtime_settings_updated', 'realtime.*', {
    provider: v.provider,
    hasCustomUrl: Boolean(v.customWsUrl),
  });
  revalidatePath('/super-admin/settings');
  return { ok: true, message: 'Realtime settings saved.' };
}

const stripeSchema = z.object({
  enabled: z.preprocess((x) => x === 'on', z.boolean()),
  publishableKey: optText,
  secretKey: optText,
  webhookSecret: optText,
});

export async function updateStripeSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const admin = await requireRole([ROLES.SUPER_ADMIN]);
  const parsed = stripeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const v = parsed.data;

  await Promise.all([
    upsertPlatformSetting({ key: 'stripe.enabled', value: v.enabled, updatedBy: admin.userId }),
    upsertPlatformSetting({
      key: 'stripe.publishable_key',
      value: v.publishableKey ?? null,
      updatedBy: admin.userId,
    }),
    v.secretKey
      ? upsertPlatformSetting({
          key: 'stripe.secret_key',
          value: v.secretKey,
          isSecret: true,
          updatedBy: admin.userId,
        })
      : Promise.resolve(),
    v.webhookSecret
      ? upsertPlatformSetting({
          key: 'stripe.webhook_secret',
          value: v.webhookSecret,
          isSecret: true,
          updatedBy: admin.userId,
        })
      : Promise.resolve(),
  ]);
  await settingEvent(admin.userId, 'stripe_settings_updated', 'stripe.*', {
    enabled: v.enabled,
    secretKeyUpdated: Boolean(v.secretKey),
    webhookSecretUpdated: Boolean(v.webhookSecret),
  });
  revalidatePath('/super-admin/settings');
  revalidatePath('/super-admin/billing');
  return { ok: true, message: 'Stripe settings saved.' };
}
