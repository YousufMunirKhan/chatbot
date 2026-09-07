'use client';

import * as React from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';
import { Textarea } from '@/components/ui/textarea';
import { saveReportScheduleAction, type ActionState } from '@/modules/company/reports-actions';

export interface ScheduleOption {
  value: string;
  label: string;
}

export interface EditableSchedule {
  id: string;
  name: string;
  tab: string;
  rangeKey: string;
  frequency: string;
  dayOfWeek: number;
  dayOfMonth: number;
  sendHour: number;
  recipients: string[];
}

/**
 * Create or edit a scheduled report.
 *
 * Every option list arrives as a prop rather than being imported. The lists
 * live in `reports-data.ts`, which pulls in the Supabase service client — a
 * `'use client'` module that imported it would drag the database client into
 * the browser bundle. The page passes them down as plain arrays instead.
 *
 * The only reason this is a client component at all is the frequency switch:
 * "every week" needs a day of the week, "every month" needs a day of the month,
 * and showing all three at once is how a form ends up with a day-of-week
 * setting that quietly does nothing. Both controls stay mounted and are hidden
 * rather than unmounted, so the server always receives a value for each and the
 * one it ignores is the one the frequency says to ignore.
 */
export function ReportScheduleForm({
  tabs,
  ranges,
  frequencies,
  weekdays,
  schedule,
  emailConfigured,
  timeZoneLabel,
}: {
  tabs: ScheduleOption[];
  ranges: ScheduleOption[];
  frequencies: ScheduleOption[];
  weekdays: ScheduleOption[];
  schedule?: EditableSchedule;
  emailConfigured: boolean;
  timeZoneLabel: string;
}) {
  const [state, action] = useFormState<ActionState, FormData>(saveReportScheduleAction, {});
  const [frequency, setFrequency] = React.useState(schedule?.frequency ?? 'weekly');
  const formRef = React.useRef<HTMLFormElement>(null);
  const editing = Boolean(schedule);

  // Clear the form after a new schedule is created, so the next one starts
  // empty instead of looking like it saved twice. An edit keeps its values.
  React.useEffect(() => {
    if (state.ok && !editing) {
      formRef.current?.reset();
      setFrequency('weekly');
    }
  }, [state, editing]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      {schedule ? <input type="hidden" name="id" value={schedule.id} /> : null}

      <FormField
        label="Name this report"
        htmlFor="schedule-name"
        required
        hint="This is the email subject, so make it something the recipient will recognise in a full inbox."
      >
        <Input
          id="schedule-name"
          name="name"
          defaultValue={schedule?.name ?? ''}
          placeholder="Monday morning numbers"
          maxLength={80}
          required
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Which section"
          htmlFor="schedule-tab"
          hint="The same figures as that tab of this page."
        >
          <Select id="schedule-tab" name="tab" defaultValue={schedule?.tab ?? 'overview'}>
            {tabs.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Covering"
          htmlFor="schedule-range"
          hint="Worked out fresh each time it is sent, so “last month” always means the month that just ended."
        >
          <Select id="schedule-range" name="rangeKey" defaultValue={schedule?.rangeKey ?? 'last_30'}>
            {ranges.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="How often" htmlFor="schedule-frequency">
          <Select
            id="schedule-frequency"
            name="frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          >
            {frequencies.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </FormField>

        <div hidden={frequency !== 'weekly'}>
          <FormField label="On" htmlFor="schedule-day-of-week">
            <Select
              id="schedule-day-of-week"
              name="dayOfWeek"
              defaultValue={String(schedule?.dayOfWeek ?? 1)}
            >
              {weekdays.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div hidden={frequency !== 'monthly'}>
          <FormField
            label="On day"
            htmlFor="schedule-day-of-month"
            hint="1 to 28, so it exists in February too."
          >
            <Input
              id="schedule-day-of-month"
              name="dayOfMonth"
              type="number"
              min={1}
              max={28}
              defaultValue={schedule?.dayOfMonth ?? 1}
            />
          </FormField>
        </div>

        <FormField
          label="At (hour)"
          htmlFor="schedule-hour"
          hint={`${timeZoneLabel} — your own clock, not the server's.`}
        >
          <Select id="schedule-hour" name="sendHour" defaultValue={String(schedule?.sendHour ?? 7)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField
        label="Send it to"
        htmlFor="schedule-recipients"
        required
        hint="One address per line, or separated by commas. Each person gets their own copy, so nobody sees the rest of the list."
      >
        <Textarea
          id="schedule-recipients"
          name="recipients"
          rows={3}
          defaultValue={(schedule?.recipients ?? []).join('\n')}
          placeholder={'you@example.com\naccountant@example.com'}
          required
        />
      </FormField>

      {!emailConfigured ? (
        <p className="text-xs text-warning-fg">
          This platform has no email provider set up yet. The schedule will save and wait — every
          run it has to skip is listed under Recent sends with the reason, so nothing goes missing
          quietly.
        </p>
      ) : null}

      <FormMessage state={state} okText={state.message ?? 'Saved.'} />

      <SubmitButton>{editing ? 'Save changes' : 'Create schedule'}</SubmitButton>
    </form>
  );
}
