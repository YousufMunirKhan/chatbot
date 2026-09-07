'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { WEBHOOK_EVENTS } from '@/lib/webhook-events';
import { createWebhookAction, type ActionState } from '../webhooks-actions';

const initial: ActionState = {};

export function WebhookForm({ atLimit }: { atLimit?: boolean }) {
  const [state, action] = useFormState(createWebhookAction, initial);
  const [kind, setKind] = useState<'generic' | 'slack'>('generic');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Where is it going" htmlFor="kind">
          {/* One of the three 36px selects — `size="sm"` keeps the height
              rather than silently promoting it to 40px. */}
          <Select
            size="sm"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'generic' | 'slack')}
          >
            <option value="generic">Generic webhook (JSON / Zapier / Make)</option>
            <option value="slack">Slack</option>
          </Select>
        </FormField>
        <FormField
          label="Call it something"
          htmlFor="label"
          hint="Optional, but it is how you will recognise this row later."
        >
          <Input name="label" placeholder="e.g. My CRM" />
        </FormField>
      </div>

      <FormField
        label={kind === 'slack' ? 'The web address Slack gave you' : 'The web address to send to'}
        htmlFor="url"
        hint={
          kind === 'slack'
            ? 'In Slack, go to Apps → Incoming Webhooks → Add to a channel. Slack shows you an address starting https://hooks.slack.com — paste the whole thing here.'
            : 'The receiving app gives you this — it is often called a webhook URL or a catch hook. If you do not have one, whoever looks after that system will.'
        }
      >
        <Input
          name="url"
          type="url"
          required
          placeholder={
            kind === 'slack'
              ? 'https://hooks.slack.com/services/…'
              : 'https://your-system.com/webhook'
          }
        />
      </FormField>

      {/* A <Label> with no htmlFor labels nothing — it was a bare heading over a
          <div> of checkboxes. fieldset/legend is what groups several controls
          under one name, and it is the pattern api-key-form.tsx already uses for
          its scopes. */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tell this destination about</legend>
        <p className="text-xs text-muted-foreground">
          Untick anything you do not want copied across. You can change this later.
        </p>
        <div className="flex flex-wrap gap-4">
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="events"
                value={event.value}
                defaultChecked
                className="h-4 w-4"
              />
              {event.label}
            </label>
          ))}
        </div>
      </fieldset>

      <FormMessage state={state} okText="Webhook added." />
      <SubmitButton disabled={atLimit}>Add webhook</SubmitButton>
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          You&apos;ve reached your plan&apos;s endpoint limit. Upgrade to add more.
        </p>
      ) : null}
    </form>
  );
}
