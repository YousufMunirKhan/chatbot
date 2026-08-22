'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  CHAT_PROVIDERS,
  EMBED_PROVIDERS,
  chatProviderById,
  embedProviderById,
} from '@/lib/ai/registry';
import type { PlatformSettingsView } from '../settings-data';
import {
  sendTestEmailAction,
  testAiSettingsAction,
  updateAiSettingsAction,
  updateEmailSettingsAction,
  updateRealtimeSettingsAction,
  updateStripeSettingsAction,
  type SettingsActionState,
} from '../settings-actions';

const initial: SettingsActionState = {};

/**
 * These actions carry a per-result `message` (e.g. the provider test verdict),
 * so the success copy is read off the state rather than fixed at the call site.
 */
function okText(state: SettingsActionState) {
  return state.message ?? 'Saved.';
}

const KEY_FIELDS: Array<{
  id: string;
  field: string;
  label: string;
  placeholder: string;
  hasFlag: keyof PlatformSettingsView['ai'];
}> = [
  {
    id: 'openai',
    field: 'openaiApiKey',
    label: 'OpenAI API key',
    placeholder: 'sk-...',
    hasFlag: 'hasOpenaiKey',
  },
  {
    id: 'anthropic',
    field: 'anthropicApiKey',
    label: 'Claude (Anthropic) API key',
    placeholder: 'sk-ant-...',
    hasFlag: 'hasAnthropicKey',
  },
  {
    id: 'gemini',
    field: 'geminiApiKey',
    label: 'Google Gemini API key',
    placeholder: 'AIza...',
    hasFlag: 'hasGeminiKey',
  },
  {
    id: 'deepseek',
    field: 'deepseekApiKey',
    label: 'DeepSeek API key',
    placeholder: 'sk-...',
    hasFlag: 'hasDeepseekKey',
  },
  {
    id: 'grok',
    field: 'grokApiKey',
    label: 'xAI Grok API key',
    placeholder: 'xai-...',
    hasFlag: 'hasGrokKey',
  },
];

function ModelSelect({
  id,
  name,
  value,
  onChange,
  def,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  def: (typeof CHAT_PROVIDERS)[number];
}) {
  const known = [...def.models.latest, ...def.models.older];
  return (
    <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known.includes(value) ? <option value={value}>{value} (current)</option> : null}
      <optgroup label="Latest">
        {def.models.latest.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </optgroup>
      {def.models.older.length ? (
        <optgroup label="Older">
          {def.models.older.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}

export function AiSettingsForm({ settings }: { settings: PlatformSettingsView['ai'] }) {
  const [state, action] = useFormState(updateAiSettingsAction, initial);
  const [testState, testAction] = useFormState(testAiSettingsAction, initial);

  const [chatProvider, setChatProvider] = useState(settings.chatProvider);
  const [chatModel, setChatModel] = useState(settings.chatModel);
  const [advancedModel, setAdvancedModel] = useState(settings.advancedChatModel);
  const [embedProvider, setEmbedProvider] = useState(settings.embeddingProvider);
  const [embedModel, setEmbedModel] = useState(settings.embeddingModel);

  const chatDef = chatProviderById(chatProvider) ?? CHAT_PROVIDERS[0]!;
  const embedDef = embedProviderById(embedProvider) ?? EMBED_PROVIDERS[0]!;
  const activeKey = KEY_FIELDS.find((k) => k.id === chatProvider);
  const inactiveKeys = KEY_FIELDS.filter((k) => k.id !== chatProvider);

  function onChatProvider(id: string) {
    setChatProvider(id);
    const def = chatProviderById(id);
    if (def) {
      setChatModel(def.defaultChat);
      setAdvancedModel(def.defaultAdvanced);
    }
  }
  function onEmbedProvider(id: string) {
    setEmbedProvider(id);
    const def = embedProviderById(id);
    if (def) setEmbedModel(def.defaultModel);
  }

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Chat provider" htmlFor="chatProvider">
            <Select
              id="chatProvider"
              name="chatProvider"
              value={chatProvider}
              onChange={(e) => onChatProvider(e.target.value)}
            >
              {CHAT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Default chat model" htmlFor="chatModel">
            <ModelSelect
              id="chatModel"
              name="chatModel"
              value={chatModel}
              onChange={setChatModel}
              def={chatDef}
            />
          </FormField>
          <FormField label="Advanced chat model (hard questions)" htmlFor="advancedChatModel">
            <ModelSelect
              id="advancedChatModel"
              name="advancedChatModel"
              value={advancedModel}
              onChange={setAdvancedModel}
              def={chatDef}
            />
          </FormField>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-1 text-sm font-medium">Embeddings (knowledge search)</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Separate from chat — most chat models (Claude, Grok, DeepSeek) don’t do embeddings.
            “Free built-in search” needs no key.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Embedding provider" htmlFor="embeddingProvider">
              <Select
                id="embeddingProvider"
                name="embeddingProvider"
                value={embedProvider}
                onChange={(e) => onEmbedProvider(e.target.value)}
              >
                {EMBED_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Embedding model" htmlFor="embeddingModel">
              <Select
                id="embeddingModel"
                name="embeddingModel"
                value={embedModel}
                onChange={(e) => setEmbedModel(e.target.value)}
                disabled={embedDef.models.length <= 1}
              >
                {(embedDef.models.includes(embedModel)
                  ? embedDef.models
                  : [embedModel, ...embedDef.models]
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Active provider key</p>
            <p className="text-xs text-muted-foreground">
              Only this selected chat provider is used for replies. Saved keys below are kept for
              future rotation and are not active.
            </p>
          </div>
          {activeKey ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor={activeKey.field}
                label={
                  <>
                    {activeKey.label}
                    <span className="ms-2 text-xs text-success-fg">active</span>
                  </>
                }
              >
                <Input
                  id={activeKey.field}
                  name={activeKey.field}
                  type="password"
                  placeholder={
                    settings[activeKey.hasFlag] ? 'Saved. Leave blank to keep.' : activeKey.placeholder
                  }
                />
              </FormField>
            </div>
          ) : null}
          <details className="rounded-md border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Advanced saved provider keys
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {inactiveKeys.map((k) => (
                <FormField key={k.id} label={k.label} htmlFor={k.field}>
                  <Input
                    id={k.field}
                    name={k.field}
                    type="password"
                    placeholder={settings[k.hasFlag] ? 'Saved. Leave blank to keep.' : k.placeholder}
                  />
                </FormField>
              ))}
            </div>
          </details>
        </div>

        <p className="text-xs text-muted-foreground">
          Active: <span className="font-medium">{chatDef.label}</span> for replies ·{' '}
          <span className="font-medium">{embedDef.label}</span> for search. One provider at a time —
          no fallback.
        </p>
        <FormMessage state={state} okText={okText(state)} />
        <SubmitButton pendingLabel="Saving...">Save AI settings</SubmitButton>
      </form>

      <form action={testAction} className="space-y-2">
        <FormMessage state={testState} okText={okText(testState)} />
        <Button type="submit" variant="outline">
          Test current AI provider
        </Button>
      </form>
    </div>
  );
}

export function EmailSettingsForm({ settings }: { settings: PlatformSettingsView['email'] }) {
  const [state, action] = useFormState(updateEmailSettingsAction, initial);
  const [testState, testAction] = useFormState(sendTestEmailAction, initial);
  const [provider, setProvider] = useState(settings.provider);

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Email provider" htmlFor="provider">
            <Select
              id="provider"
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="disabled">Disabled</option>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </Select>
          </FormField>
          {provider !== 'disabled' ? (
            <>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={settings.enabled}
                  className="h-4 w-4"
                />
                Email sending enabled
              </label>
              <FormField label="From email" htmlFor="fromEmail">
                <Input
                  id="fromEmail"
                  name="fromEmail"
                  type="email"
                  defaultValue={settings.fromEmail}
                  placeholder="support@example.com"
                />
              </FormField>
              <FormField label="From name" htmlFor="fromName">
                <Input id="fromName" name="fromName" defaultValue={settings.fromName} />
              </FormField>
              <FormField label="Reply-to email" htmlFor="replyTo">
                <Input id="replyTo" name="replyTo" type="email" defaultValue={settings.replyTo} />
              </FormField>
            </>
          ) : null}
          {provider === 'resend' ? (
            <FormField label="Resend API key" htmlFor="resendApiKey">
              <Input
                id="resendApiKey"
                name="resendApiKey"
                type="password"
                placeholder={settings.hasResendKey ? 'Saved. Leave blank to keep.' : 're_...'}
              />
            </FormField>
          ) : null}
        </div>

        {provider === 'smtp' ? (
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <FormField label="SMTP host" htmlFor="smtpHost">
              <Input id="smtpHost" name="smtpHost" defaultValue={settings.smtpHost} />
            </FormField>
            <FormField label="SMTP port" htmlFor="smtpPort">
              <Input
                id="smtpPort"
                name="smtpPort"
                type="number"
                min={1}
                max={65535}
                defaultValue={settings.smtpPort}
                placeholder="587"
              />
            </FormField>
            <FormField label="SMTP username" htmlFor="smtpUsername">
              <Input id="smtpUsername" name="smtpUsername" defaultValue={settings.smtpUsername} />
            </FormField>
            <FormField label="SMTP password" htmlFor="smtpPassword">
              <Input
                id="smtpPassword"
                name="smtpPassword"
                type="password"
                placeholder={settings.hasSmtpPassword ? 'Saved. Leave blank to keep.' : ''}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="smtpSecure"
                defaultChecked={settings.smtpSecure}
                className="h-4 w-4"
              />
              Use TLS
            </label>
          </div>
        ) : null}
        <FormMessage state={state} okText={okText(state)} />
        <SubmitButton pendingLabel="Saving...">Save email settings</SubmitButton>
      </form>

      <form action={testAction} className="flex flex-wrap items-end gap-3">
        <FormField label="Send test email" htmlFor="testEmail" className="min-w-64 flex-1">
          <Input id="testEmail" name="testEmail" type="email" placeholder="you@example.com" />
        </FormField>
        <Button type="submit" variant="outline">
          Send test
        </Button>
        <FormMessage state={testState} okText={okText(testState)} />
      </form>
    </div>
  );
}

export function RealtimeSettingsForm({ settings }: { settings: PlatformSettingsView['realtime'] }) {
  const [state, action] = useFormState(updateRealtimeSettingsAction, initial);
  const [provider, setProvider] = useState(settings.provider);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Realtime provider" htmlFor="provider">
          <Select
            id="provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="supabase">Supabase Realtime</option>
            <option value="custom_websocket">Advanced: Custom WebSocket</option>
          </Select>
        </FormField>
        {provider === 'custom_websocket' ? (
          <FormField label="Custom WebSocket URL" htmlFor="customWsUrl">
            <Input
              id="customWsUrl"
              name="customWsUrl"
              defaultValue={settings.customWsUrl}
              placeholder="wss://chat.example.com"
            />
          </FormField>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {provider === 'custom_websocket'
          ? 'Use this only after deploying a separate high-scale socket service.'
          : 'Supabase Realtime is the active no-polling chat transport.'}
      </p>
      <FormMessage state={state} okText={okText(state)} />
      <SubmitButton pendingLabel="Saving...">Save realtime settings</SubmitButton>
    </form>
  );
}

export function StripeSettingsForm({ settings }: { settings: PlatformSettingsView['stripe'] }) {
  const [state, action] = useFormState(updateStripeSettingsAction, initial);

  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          className="mt-1 h-4 w-4"
        />
        <span>
          <span className="block font-medium">Enable Stripe checkout</span>
          <span className="text-xs text-muted-foreground">
            Company admins can purchase mapped public plans from their Billing page.
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Publishable key" htmlFor="publishableKey">
          <Input
            id="publishableKey"
            name="publishableKey"
            defaultValue={settings.publishableKey}
            placeholder="pk_live_..."
          />
        </FormField>
        <FormField label="Secret key" htmlFor="secretKey">
          <Input
            id="secretKey"
            name="secretKey"
            type="password"
            placeholder={settings.hasSecretKey ? 'Saved. Leave blank to keep.' : 'sk_live_...'}
          />
        </FormField>
        <FormField label="Webhook secret" htmlFor="webhookSecret">
          <Input
            id="webhookSecret"
            name="webhookSecret"
            type="password"
            placeholder={settings.hasWebhookSecret ? 'Saved. Leave blank to keep.' : 'whsec_...'}
          />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">
        Add your webhook endpoint in Stripe as{' '}
        <span className="font-mono">/api/webhooks/stripe</span>. In production, webhook signature
        verification must be enabled with the webhook secret.
      </p>
      <FormMessage state={state} okText={okText(state)} />
      <SubmitButton pendingLabel="Saving...">Save Stripe settings</SubmitButton>
    </form>
  );
}
