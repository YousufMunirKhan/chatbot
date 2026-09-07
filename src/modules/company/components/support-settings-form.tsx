'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSupportSettingsAction, type ActionState } from '../settings-actions';
import type { SupportSettings } from '../support-settings-data';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
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
      {pending ? 'Saving…' : 'Save these inbox rules'}
    </Button>
  );
}

export function SupportSettingsForm({ settings }: { settings: SupportSettings }) {
  const [state, action] = useFormState(updateSupportSettingsAction, initial);
  const bh = settings.businessHours;

  return (
    <form action={action} className="space-y-6">
      {/* "SLA" is banned from the company panel — see the audience note at the
          top of src/lib/labels.ts. The owner is setting a promise, not signing a
          service-level agreement. The hint carries the unit AND a worked
          example, because this is the field people get wrong by a factor of
          sixty. */}
      <FormField
        label="Answer within"
        htmlFor="slaResponseMinutes"
        hint="Minutes. The clock starts the moment a chat needs a person — not when the chat started. Anything still unanswered after this shows as late in your inbox. 15 means a quarter of an hour; 120 means two hours."
      >
        <Input
          name="slaResponseMinutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={settings.slaResponseMinutes}
        />
      </FormField>

      <FormField
        label="Who gets a chat when the assistant hands one over"
        htmlFor="routingStrategy"
        hint="Only people marked as at their desk are picked. If nobody is, the chat waits in the inbox for whoever opens it first — it is never dropped."
      >
        <Select name="routingStrategy" defaultValue={settings.routingStrategy}>
          <option value="most_recent">Whoever replied most recently</option>
          <option value="round_robin">Share them out — whoever has the fewest open chats</option>
        </Select>
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
            Open a ticket for me when something in my shop system fails
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              When the assistant tries to look something up in your shop — a price, an order, a
              stock level — and gets nothing back, a ticket appears in your inbox saying what it was
              trying to do. Leave this off and those failures are only written to the logs, where
              nobody will see them.
            </span>
          </span>
        </label>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="connectorFailureTicketDelayMinutes">
            Warn me if it is still waiting after
          </Label>
          <Input
            id="connectorFailureTicketDelayMinutes"
            name="connectorFailureTicketDelayMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={settings.connectorFailureTicketDelayMinutes}
            aria-describedby="connectorFailureTicketDelayMinutes-hint"
          />
          <p id="connectorFailureTicketDelayMinutes-hint" className="text-xs text-muted-foreground">
            Minutes. Something your shop system was asked to do can sit in a queue rather than fail
            outright, which is worse — nothing looks broken. This is how long you are willing to let
            it sit before you are told.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="businessHoursEnabled"
            defaultChecked={bh.enabled}
            className="h-4 w-4"
          />
          Only count the time while you are open
        </label>
        {bh.source === 'business_data' ? (
          // Opening hours are owned by My business info so the assistant and the
          // reply-time clock can never disagree about whether you are open.
          <div className="space-y-2">
            <ul className="grid gap-1 sm:grid-cols-2">
              {(bh.schedule ?? []).map((d) => (
                <li
                  key={d.day}
                  className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span>{DAY_LABELS[d.day] ?? `Day ${d.day}`}</span>
                  <span className="text-muted-foreground">
                    {d.isClosed
                      ? 'Closed'
                      : d.open && d.close
                        ? `${d.open} – ${d.close}`
                        : 'Open all day'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              These are the opening hours saved in My business info — the same hours the assistant
              quotes to customers, so the two can never disagree.{' '}
              <Link href="/company/business-data?tab=basics" className="underline">
                Change my opening hours
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label
                  key={d.i}
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="days"
                    value={d.i}
                    defaultChecked={bh.days.includes(d.i)}
                    className="h-4 w-4"
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="You open at" htmlFor="start">
                <Input name="start" type="time" defaultValue={bh.start} />
              </FormField>
              <FormField label="You close at" htmlFor="end">
                <Input name="end" type="time" defaultValue={bh.end} />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">
              This is a simple one-size-fits-all week. Add your real day-by-day hours in{' '}
              <Link href="/company/business-data?tab=basics" className="underline">
                My business info
              </Link>{' '}
              and the reply-time clock will follow those instead.
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Times are in{' '}
          <span className="font-medium text-foreground">{bh.timezone.replace(/_/g, ' ')}</span> —
          change that once in{' '}
          <Link href="/company/business-data?tab=basics" className="underline">
            My business info
          </Link>
          .
        </p>
      </div>

      {/* The hand-rolled pair this replaces was not a live region, so a screen
          reader user pressed Save and was told nothing at all. */}
      <FormMessage state={state} okText="Saved. Your inbox uses these from now on." />
      <Save />
    </form>
  );
}
