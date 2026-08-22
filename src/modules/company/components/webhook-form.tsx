'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createWebhookAction, type ActionState } from '../webhooks-actions';

const initial: ActionState = {};
const EVENTS = [
  { value: 'lead.created', label: 'New lead' },
  { value: 'appointment.created', label: 'Appointment request' },
  { value: 'order.created', label: 'New order' },
  { value: 'ticket.created', label: 'Ticket created' },
  { value: 'ticket.resolved', label: 'Ticket resolved' },
] as const;

export function WebhookForm({ atLimit }: { atLimit?: boolean }) {
  const [state, action] = useFormState(createWebhookAction, initial);
  const [kind, setKind] = useState<'generic' | 'slack'>('generic');

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type" htmlFor="kind">
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
        <FormField label="Label (optional)" htmlFor="label">
          <Input name="label" placeholder="e.g. My CRM" />
        </FormField>
      </div>

      <FormField label={kind === 'slack' ? 'Slack Incoming Webhook URL' : 'Endpoint URL'} htmlFor="url">
        <Input
          name="url"
          type="url"
          required
          placeholder={kind === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://your-system.com/webhook'}
        />
      </FormField>

      <div className="space-y-2">
        <Label>Send these events</Label>
        <div className="flex flex-wrap gap-4">
          {EVENTS.map((event) => (
            <label key={event.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={event.value} defaultChecked className="h-4 w-4" />
              {event.label}
            </label>
          ))}
        </div>
      </div>

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
