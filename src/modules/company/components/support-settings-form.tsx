'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSupportSettingsAction, type ActionState } from '../settings-actions';
import type { SupportSettings } from '../support-settings-data';

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
      <div className="space-y-1.5">
        <Label htmlFor="slaResponseMinutes">First-response SLA (minutes)</Label>
        <Input
          id="slaResponseMinutes"
          name="slaResponseMinutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={settings.slaResponseMinutes}
        />
        <p className="text-xs text-muted-foreground">
          Conversations waiting on a human longer than this count as “Missed SLA” in the inbox.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="routingStrategy">Agent routing</Label>
        <select
          id="routingStrategy"
          name="routingStrategy"
          defaultValue={settings.routingStrategy}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="most_recent">Most recently active agent</option>
          <option value="round_robin">Round-robin (balance load)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Round-robin assigns new handoffs to the online agent with the fewest open chats.
        </p>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="businessHoursEnabled" defaultChecked={bh.enabled} className="h-4 w-4" />
          Enable business hours (pauses SLA tracking when closed)
        </label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label key={d.i} className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
              <input type="checkbox" name="days" value={d.i} defaultChecked={bh.days.includes(d.i)} className="h-4 w-4" />
              {d.label}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="start">Opens</Label>
            <Input id="start" name="start" type="time" defaultValue={bh.start} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">Closes</Label>
            <Input id="end" name="end" type="time" defaultValue={bh.end} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone (IANA)</Label>
            <Input id="timezone" name="timezone" defaultValue={bh.timezone} placeholder="Asia/Dubai" />
          </div>
        </div>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600">Saved.</p> : null}
      <Save />
    </form>
  );
}
