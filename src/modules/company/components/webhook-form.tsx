'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWebhookAction, type ActionState } from '../webhooks-actions';

const initial: ActionState = {};
const EVENTS = ['lead.created', 'appointment.created', 'order.created'] as const;

function Submit({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Add webhook'}
    </Button>
  );
}

export function WebhookForm({ atLimit }: { atLimit?: boolean }) {
  const [state, action] = useFormState(createWebhookAction, initial);
  const [kind, setKind] = useState<'generic' | 'slack'>('generic');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Type</Label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'generic' | 'slack')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="generic">Generic webhook (JSON / Zapier / Make)</option>
            <option value="slack">Slack</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" name="label" placeholder="e.g. My CRM" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="url">{kind === 'slack' ? 'Slack Incoming Webhook URL' : 'Endpoint URL'}</Label>
        <Input
          id="url"
          name="url"
          type="url"
          required
          placeholder={kind === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://your-system.com/webhook'}
        />
      </div>

      <div className="space-y-2">
        <Label>Send these events</Label>
        <div className="flex flex-wrap gap-4">
          {EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={e} defaultChecked className="h-4 w-4" />
              {e}
            </label>
          ))}
        </div>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Webhook added.</p> : null}
      <Submit disabled={atLimit} />
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          You&apos;ve reached your plan&apos;s endpoint limit. Upgrade to add more.
        </p>
      ) : null}
    </form>
  );
}
