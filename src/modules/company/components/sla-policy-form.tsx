'use client';

import { useFormState } from 'react-dom';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID } from './form-layout';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { saveSlaPolicyAction, type ActionState } from '@/modules/company/sla-actions';
import type { SlaPolicyRow, TeamMemberOption } from '@/modules/company/sla-data';

const PRIORITIES = [
  { value: '', label: 'Any priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

function Submit({ editing }: { editing: boolean }) {
  return (
    <SubmitButton pendingLabel="Saving…">
      {editing ? 'Save changes' : 'Create policy'}
    </SubmitButton>
  );
}

export function SlaPolicyForm({
  channels,
  members,
  policy,
}: {
  channels: Array<{ value: string; label: string }>;
  members: TeamMemberOption[];
  policy?: SlaPolicyRow;
}) {
  const [state, action] = useFormState<ActionState, FormData>(saveSlaPolicyAction, {});
  const editing = Boolean(policy);

  return (
    <form action={action} className="space-y-4">
      {policy ? <input type="hidden" name="id" value={policy.id} /> : null}

      <FormField
        label="Name this target"
        htmlFor="sla-name"
        required
        hint="Only you see this. Something like “Urgent WhatsApp” makes the list readable later."
      >
        <Input
          id="sla-name"
          name="name"
          defaultValue={policy?.name ?? ''}
          placeholder="Urgent — 5 minute response"
          required
        />
      </FormField>

      <div className={FIELD_GRID}>
        <FormField
          label="Only for chats marked"
          htmlFor="sla-priority"
          hint="Leave on Any and this target covers every chat."
        >
          <Select
            id="sla-priority"
            name="appliesPriority"
            defaultValue={policy?.appliesPriority ?? ''}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Only for chats from"
          htmlFor="sla-channel"
          hint="Leave on Any channel unless you answer faster somewhere — WhatsApp, usually."
        >
          <Select
            id="sla-channel"
            name="appliesChannel"
            defaultValue={policy?.appliesChannel ?? ''}
          >
            <option value="">Any channel</option>
            {channels.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className={FIELD_GRID}>
        {/* The other half of the pair described in support-settings-form.tsx.
            This column (`sla_policies.first_response_minutes`) is the one the
            clock, the warning and the escalation all read
            (src/lib/sla/index.ts:60-83). The number on Inbox rules is a
            different column that only colours a chip in the inbox. Both screens
            now say which is which, so nobody sets 5 on one and 15 on the other
            and wonders why the warnings never match the badges. */}
        <FormField
          label="Answer within (minutes)"
          htmlFor="sla-first"
          required
          hint="The clock starts the moment a chat needs a person, not when the customer first wrote. 15 means someone on your team should have replied within a quarter of an hour. This is the number that decides the warnings and escalations below — the one on Inbox rules only colours the badge in your inbox and is set separately."
        >
          <Input
            id="sla-first"
            name="firstResponseMinutes"
            type="number"
            min={1}
            defaultValue={policy?.firstResponseMinutes ?? 15}
            required
          />
        </FormField>

        <FormField
          label="Finish within (minutes)"
          htmlFor="sla-resolve"
          hint="Optional, and a much longer number than the one on the left — how long the whole thing should take to sort out. 1440 is a day."
        >
          <Input
            id="sla-resolve"
            name="resolutionMinutes"
            type="number"
            min={1}
            defaultValue={policy?.resolutionMinutes ?? ''}
          />
        </FormField>
      </div>

      <div className={FIELD_GRID}>
        <FormField
          label="Warn me this many minutes early"
          htmlFor="sla-warn"
          hint="We nudge you while there is still time to make it, rather than telling you afterwards."
        >
          <Input
            id="sla-warn"
            name="escalateBeforeMinutes"
            type="number"
            min={1}
            defaultValue={policy?.escalateBeforeMinutes ?? ''}
          />
        </FormField>

        <FormField
          label="Who gets the warning"
          htmlFor="sla-escalate"
          hint="Pick a person if one of your team should always be told."
        >
          <Select
            id="sla-escalate"
            name="escalateToUserId"
            defaultValue={policy?.escalateToUserId ?? ''}
          >
            <option value="">Nobody in particular</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className={FIELD_GRID}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="businessHoursOnly"
            value="true"
            defaultChecked={policy?.businessHoursOnly ?? false}
            className="h-4 w-4 rounded border-input"
          />
          <span>Only count the hours you are open</span>
        </label>

        <FormField
          label="Which target wins"
          htmlFor="sla-order"
          hint="If two of your targets both fit a chat, the one with the higher number here is used."
        >
          <Input
            id="sla-order"
            name="priority"
            type="number"
            min={0}
            max={100}
            defaultValue={policy?.priority ?? 0}
          />
        </FormField>
      </div>

      <FormMessage state={state} okText="Policy saved." />

      <Submit editing={editing} />
    </form>
  );
}
