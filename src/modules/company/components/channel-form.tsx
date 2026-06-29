'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Connect channel'}
    </Button>
  );
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
      <div className="space-y-1.5">
        <Label htmlFor="channel">Channel</Label>
        <select
          id="channel"
          name="channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram / Messenger</option>
          <option value="email">Email</option>
        </select>
      </div>

      {channel === 'whatsapp' ? (
        <div className="space-y-1.5">
          <Label htmlFor="provider">Provider</Label>
          <select
            id="provider"
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="meta_cloud">Meta WhatsApp Cloud API (direct)</option>
            <option value="twilio">Twilio (no Meta verification)</option>
          </select>
        </div>
      ) : (
        <input type="hidden" name="provider" value="meta_cloud" />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="externalId">{meta.idLabel}</Label>
        <Input id="externalId" name="externalId" required maxLength={200} />
        <p className="text-xs text-muted-foreground">{meta.idHint}</p>
      </div>

      {meta.secretLabel ? (
        <div className="space-y-1.5">
          <Label htmlFor="secret">{meta.secretLabel}</Label>
          <Input id="secret" name="secret" type="password" autoComplete="off" />
          <p className="text-xs text-muted-foreground">Stored encrypted. Used only to send replies.</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="botId">Answer with bot</Label>
        <select id="botId" name="botId" className="h-10 w-full rounded-md border bg-background px-3 text-sm">
          <option value="">Default customer bot</option>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Channel connected.</p> : null}
      <Save />
    </form>
  );
}
