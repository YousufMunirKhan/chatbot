'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
const selectCls =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving...' : label}
    </Button>
  );
}

function Status({ state }: { state: SettingsActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-600">{state.message ?? 'Saved.'}</p>;
  return null;
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
    <select
      id={id}
      name={name}
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
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
    </select>
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
          <div className="space-y-1.5">
            <Label htmlFor="chatProvider">Chat provider</Label>
            <select
              id="chatProvider"
              name="chatProvider"
              className={selectCls}
              value={chatProvider}
              onChange={(e) => onChatProvider(e.target.value)}
            >
              {CHAT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chatModel">Default chat model</Label>
            <ModelSelect
              id="chatModel"
              name="chatModel"
              value={chatModel}
              onChange={setChatModel}
              def={chatDef}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="advancedChatModel">Advanced chat model (hard questions)</Label>
            <ModelSelect
              id="advancedChatModel"
              name="advancedChatModel"
              value={advancedModel}
              onChange={setAdvancedModel}
              def={chatDef}
            />
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="mb-1 text-sm font-medium">Embeddings (knowledge search)</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Separate from chat — most chat models (Claude, Grok, DeepSeek) don’t do embeddings.
            “Free built-in search” needs no key.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="embeddingProvider">Embedding provider</Label>
              <select
                id="embeddingProvider"
                name="embeddingProvider"
                className={selectCls}
                value={embedProvider}
                onChange={(e) => onEmbedProvider(e.target.value)}
              >
                {EMBED_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="embeddingModel">Embedding model</Label>
              <select
                id="embeddingModel"
                name="embeddingModel"
                className={selectCls}
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
              </select>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">API keys</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {KEY_FIELDS.map((k) => (
              <div key={k.id} className="space-y-1.5">
                <Label htmlFor={k.field}>
                  {k.label}
                  {k.id === chatProvider ? (
                    <span className="ml-2 text-xs text-emerald-600">active</span>
                  ) : null}
                </Label>
                <Input
                  id={k.field}
                  name={k.field}
                  type="password"
                  placeholder={settings[k.hasFlag] ? 'Saved. Leave blank to keep.' : k.placeholder}
                />
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Active: <span className="font-medium">{chatDef.label}</span> for replies ·{' '}
          <span className="font-medium">{embedDef.label}</span> for search. One provider at a time —
          no fallback.
        </p>
        <Status state={state} />
        <SubmitButton label="Save AI settings" />
      </form>

      <form action={testAction} className="space-y-2">
        <Status state={testState} />
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
          <div className="space-y-1.5">
            <Label htmlFor="provider">Email provider</Label>
            <select
              id="provider"
              name="provider"
              className={selectCls}
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="disabled">Disabled</option>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>
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
              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From email</Label>
                <Input
                  id="fromEmail"
                  name="fromEmail"
                  type="email"
                  defaultValue={settings.fromEmail}
                  placeholder="support@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fromName">From name</Label>
                <Input id="fromName" name="fromName" defaultValue={settings.fromName} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="replyTo">Reply-to email</Label>
                <Input id="replyTo" name="replyTo" type="email" defaultValue={settings.replyTo} />
              </div>
            </>
          ) : null}
          {provider === 'resend' ? (
            <div className="space-y-1.5">
              <Label htmlFor="resendApiKey">Resend API key</Label>
              <Input
                id="resendApiKey"
                name="resendApiKey"
                type="password"
                placeholder={settings.hasResendKey ? 'Saved. Leave blank to keep.' : 're_...'}
              />
            </div>
          ) : null}
        </div>

        {provider === 'smtp' ? (
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtpHost">SMTP host</Label>
              <Input id="smtpHost" name="smtpHost" defaultValue={settings.smtpHost} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPort">SMTP port</Label>
              <Input
                id="smtpPort"
                name="smtpPort"
                type="number"
                min={1}
                max={65535}
                defaultValue={settings.smtpPort}
                placeholder="587"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpUsername">SMTP username</Label>
              <Input id="smtpUsername" name="smtpUsername" defaultValue={settings.smtpUsername} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtpPassword">SMTP password</Label>
              <Input
                id="smtpPassword"
                name="smtpPassword"
                type="password"
                placeholder={settings.hasSmtpPassword ? 'Saved. Leave blank to keep.' : ''}
              />
            </div>
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
        <Status state={state} />
        <SubmitButton label="Save email settings" />
      </form>

      <form action={testAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="testEmail">Send test email</Label>
          <Input id="testEmail" name="testEmail" type="email" placeholder="you@example.com" />
        </div>
        <Button type="submit" variant="outline">
          Send test
        </Button>
        <Status state={testState} />
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
        <div className="space-y-1.5">
          <Label htmlFor="provider">Realtime provider</Label>
          <select
            id="provider"
            name="provider"
            className={selectCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="supabase">Supabase Realtime</option>
            <option value="custom_websocket">Advanced: Custom WebSocket</option>
          </select>
        </div>
        {provider === 'custom_websocket' ? (
          <div className="space-y-1.5">
            <Label htmlFor="customWsUrl">Custom WebSocket URL</Label>
            <Input
              id="customWsUrl"
              name="customWsUrl"
              defaultValue={settings.customWsUrl}
              placeholder="wss://chat.example.com"
            />
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {provider === 'custom_websocket'
          ? 'Use this only after deploying a separate high-scale socket service.'
          : 'Supabase Realtime is the active no-polling chat transport.'}
      </p>
      <Status state={state} />
      <SubmitButton label="Save realtime settings" />
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
        <div className="space-y-1.5">
          <Label htmlFor="publishableKey">Publishable key</Label>
          <Input
            id="publishableKey"
            name="publishableKey"
            defaultValue={settings.publishableKey}
            placeholder="pk_live_..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="secretKey">Secret key</Label>
          <Input
            id="secretKey"
            name="secretKey"
            type="password"
            placeholder={settings.hasSecretKey ? 'Saved. Leave blank to keep.' : 'sk_live_...'}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="webhookSecret">Webhook secret</Label>
          <Input
            id="webhookSecret"
            name="webhookSecret"
            type="password"
            placeholder={settings.hasWebhookSecret ? 'Saved. Leave blank to keep.' : 'whsec_...'}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Add your webhook endpoint in Stripe as{' '}
        <span className="font-mono">/api/webhooks/stripe</span>. In production, webhook signature
        verification must be enabled with the webhook secret.
      </p>
      <Status state={state} />
      <SubmitButton label="Save Stripe settings" />
    </form>
  );
}
