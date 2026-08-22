'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSupportSettingsAction, type ActionState } from '../settings-actions';
import type { SupportSettings } from '../support-settings-data';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

const initial: ActionState = {};
const DAYS = [
  { i: 1, label: 'Mon' },
  { i: 2, label: 'Tue' },
  { i: 3, label: 'Wed' },
  { i: 4, label: 'Thu' },
  { i: 5, label: 'Fri' },
  { i: 6, label: 'Sat' },
  { i: 0, label: 'Sun' },
];
const DAY_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save support settings'}
    </Button>
  );
}

export function SupportSettingsForm({ settings }: { settings: SupportSettings }) {
  const [state, action] = useFormState(updateSupportSettingsAction, initial);
  const bh = settings.businessHours;

  return (
    <form action={action} className="space-y-6">
      <FormField label="First-response SLA (minutes)" htmlFor="slaResponseMinutes">
        <Input
          name="slaResponseMinutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={settings.slaResponseMinutes}
        />
        <p className="text-xs text-muted-foreground">
          Conversations waiting on a human longer than this count as “Missed SLA” in the inbox.
        </p>
      </FormField>

      <FormField label="Agent routing" htmlFor="routingStrategy">
        <Select
          name="routingStrategy"
          defaultValue={settings.routingStrategy}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="most_recent">Most recently active agent</option>
          <option value="round_robin">Round-robin (balance load)</option>
        </Select>
        <p className="text-xs text-muted-foreground">
          Round-robin assigns new handoffs to the online agent with the fewest open chats.
        </p>
      </FormField>

      <div className="space-y-3 rounded-md border p-4">
        <label className="flex items-start gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="autoTicketConnectorFailures"
            defaultChecked={settings.autoTicketConnectorFailures}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Auto-create a ticket when a connector action fails
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Failed connector events create Inbox tickets with connector context, trigger ticket.created automations, and appear in platform error logs.
            </span>
          </span>
        </label>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="connectorFailureTicketDelayMinutes">Queued action warning after minutes</Label>
          <Input
            id="connectorFailureTicketDelayMinutes"
            name="connectorFailureTicketDelayMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={settings.connectorFailureTicketDelayMinutes}
          />
          <p className="text-xs text-muted-foreground">
            Used by Help Desk prompts and future monitors to catch actions that stay queued too long.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="businessHoursEnabled" defaultChecked={bh.enabled} className="h-4 w-4" />
          Enable business hours (pauses SLA tracking when closed)
        </label>
        {bh.source === 'business_data' ? (
          // Opening hours are owned by Business Data so the bot and SLA tracking can
          // never disagree about whether the business is open.
          <div className="space-y-2">
            <ul className="grid gap-1 sm:grid-cols-2">
              {(bh.schedule ?? []).map((d) => (
                <li key={d.day} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                  <span>{DAY_LABELS[d.day] ?? `Day ${d.day}`}</span>
                  <span className="text-muted-foreground">
                    {d.isClosed ? 'Closed' : d.open && d.close ? `${d.open} – ${d.close}` : 'Open all day'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              These are your opening hours from Business Data — the same hours the assistant quotes to customers.{' '}
              <Link href="/company/business-data?tab=basics" className="underline">
                Edit opening hours
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label key={d.i} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
                  <input type="checkbox" name="days" value={d.i} defaultChecked={bh.days.includes(d.i)} className="h-4 w-4" />
                  {d.label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Opens" htmlFor="start">
                <Input name="start" type="time" defaultValue={bh.start} />
              </FormField>
              <FormField label="Closes" htmlFor="end">
                <Input name="end" type="time" defaultValue={bh.end} />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">
              Add your day-by-day opening hours in{' '}
              <Link href="/company/business-data?tab=basics" className="underline">
                Business Data
              </Link>{' '}
              and SLA tracking will follow them instead of this simplified schedule.
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Timezone: <span className="font-medium text-foreground">{bh.timezone}</span> — set once on your{' '}
          <Link href="/company/profile" className="underline">
            company profile
          </Link>
          .
        </p>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      <Save />
    </form>
  );
}
