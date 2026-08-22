'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createChannelIdentityAction, type ActionState } from '../channels-actions';

const initial: ActionState = {};

type FieldConfig = { idLabel: string; idHint: string; secretLabel: string | null };

function fieldConfig(channel: string, provider: string): FieldConfig {
  if (channel === 'whatsapp') {
    return provider === 'twilio'
      ? {
          idLabel: 'Business WhatsApp number',
          idHint: 'The Twilio WhatsApp number customers message, e.g. +14155551234.',
          secretLabel: null, // Twilio inbound replies via TwiML — no token needed
        }
      : {
          idLabel: 'WhatsApp phone number ID',
          idHint: 'Meta → WhatsApp → API setup → "Phone number ID".',
          secretLabel: 'Permanent access token',
        };
  }
  if (channel === 'instagram') {
    return {
      idLabel: 'Instagram / Page ID',
      idHint: 'The connected Page/IG account id that receives DMs.',
      secretLabel: 'Page access token',
    };
  }
  return {
    idLabel: 'Inbound email address',
    idHint: 'The address your provider forwards to this webhook, e.g. support@yourco.com.',
    secretLabel: null,
  };
}

export function ChannelForm({ bots }: { bots: Array<{ id: string; name: string }> }) {
  const [state, action] = useFormState(createChannelIdentityAction, initial);
  const [channel, setChannel] = useState<'whatsapp' | 'instagram' | 'email'>('whatsapp');
  const [provider, setProvider] = useState<'meta_cloud' | 'twilio'>('meta_cloud');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  const meta = fieldConfig(channel, provider);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <FormField label="Channel" htmlFor="channel">
        <Select
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram / Messenger</option>
          <option value="email">Email</option>
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

      <FormField label={meta.idLabel} htmlFor="externalId" hint={meta.idHint}>
        <Input name="externalId" required maxLength={200} />
      </FormField>

      {meta.secretLabel ? (
        <FormField
          label={meta.secretLabel}
          htmlFor="secret"
          hint="Stored encrypted. Used only to send replies."
        >
          <Input name="secret" type="password" autoComplete="off" />
        </FormField>
      ) : null}

      <FormField label="Answer with bot" htmlFor="botId">
        <Select name="botId">
          <option value="">Default customer bot</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormMessage state={state} okText="Channel connected." />
      <SubmitButton>Connect channel</SubmitButton>
    </form>
  );
}
