'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { CopyButton } from '@/components/copy-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createChannelIdentityAction, type ActionState } from '../channels-actions';
import type { ChannelFormDescriptor } from '../channels-data';

const initial: ActionState = {};

/**
 * What to call the "which account is this?" field per channel. The hint under it
 * comes straight from CHANNEL_DESCRIPTORS, so only the short label lives here.
 */
const ID_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp phone number ID',
  instagram: 'Instagram / Page ID',
  facebook: 'Facebook Page ID',
  email: 'Inbound email address',
  telegram: 'Telegram bot ID',
  viber: 'Viber account ID',
  line: 'LINE bot user ID',
  tiktok: 'TikTok creator open ID',
  youtube: 'YouTube channel ID',
};

export function ChannelForm({
  bots,
  channels,
}: {
  bots: Array<{ id: string; name: string }>;
  channels: ChannelFormDescriptor[];
}) {
  const [state, action] = useFormState(createChannelIdentityAction, initial);
  const [channel, setChannel] = useState<string>(channels[0]?.key ?? 'whatsapp');
  const [provider, setProvider] = useState<'meta_cloud' | 'twilio'>('meta_cloud');
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  const descriptor = useMemo(
    () => channels.find((c) => c.key === channel) ?? channels[0],
    [channels, channel],
  );
  if (!descriptor) return null;

  const isTwilioWhatsApp = channel === 'whatsapp' && provider === 'twilio';
  // Twilio replies inline with TwiML, so it needs no stored token.
  const showSecret = descriptor.secretRequired && !isTwilioWhatsApp;
  const idLabel = isTwilioWhatsApp
    ? 'Business WhatsApp number'
    : (ID_LABELS[channel] ?? 'Account id');
  const idHint = isTwilioWhatsApp
    ? 'The Twilio WhatsApp number customers message, e.g. +14155551234.'
    : descriptor.externalIdHint;

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormField label="Which app" htmlFor="channel" hint={descriptor.docsHint}>
        <Select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      </FormField>

      {channel === 'whatsapp' ? (
        <FormField label="Provider" htmlFor="provider">
          <Select
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
          >
            <option value="meta_cloud">Meta WhatsApp Cloud API (direct)</option>
            <option value="twilio">Twilio (no Meta verification)</option>
          </Select>
        </FormField>
      ) : (
        <input type="hidden" name="provider" value="meta_cloud" />
      )}

      <FormField label={idLabel} htmlFor="externalId" hint={idHint} required>
        <Input name="externalId" required maxLength={200} />
      </FormField>

      <FormField
        label="Display name"
        htmlFor="displayName"
        hint="Optional, but worth it — call it something like “Shop WhatsApp” and you will recognise it in the list below instead of reading a long number."
      >
        <Input name="displayName" maxLength={120} />
      </FormField>

      {showSecret ? (
        <FormField
          label={descriptor.secretLabel}
          htmlFor="secret"
          hint="Kept locked away, and only ever used to send your replies. We never show it again after you save."
          required
        >
          <Input name="secret" type="password" autoComplete="off" />
        </FormField>
      ) : null}

      {descriptor.needsAccessToken ? (
        <FormField
          label="Channel access token"
          htmlFor="accessToken"
          hint="LINE signs inbound webhooks with the channel secret above, but replies are sent with this long-lived access token."
          required
        >
          <Input name="accessToken" type="password" autoComplete="off" />
        </FormField>
      ) : null}

      <FormField
        label="Which assistant answers here"
        htmlFor="botId"
        hint="Leave this alone unless you have more than one assistant."
      >
        <Select name="botId">
          <option value="">My main customer assistant</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
        <p className="font-medium">Tell {descriptor.label} to send messages here</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1">
            {descriptor.webhookUrl}
          </code>
          <CopyButton value={descriptor.webhookUrl} />
        </div>
        {descriptor.identityInUrl ? (
          <p className="text-muted-foreground">
            Replace <code>&lt;your id&gt;</code> with the id above — this provider does not name the
            receiving account in its payload. Telegram and Viber are registered automatically when
            you save.
          </p>
        ) : null}
      </div>

      <FormMessage state={state} okText="Channel connected." />
      <SubmitButton>Connect this app</SubmitButton>
    </form>
  );
}
