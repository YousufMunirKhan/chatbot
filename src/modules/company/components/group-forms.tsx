'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { companyLabel } from '@/lib/labels';
import {
  addContactMemberAction,
  addTeamMemberAction,
  createGroupAction,
  type ActionState,
} from '../groups-actions';

const initial: ActionState = {};

/** Create a team group or a contact group — one form, two shapes. */
export function CreateGroupForm({ kind }: { kind: 'team' | 'contact' }) {
  const [state, action] = useFormState(createGroupAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form
      ref={ref}
      action={action}
      className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <input type="hidden" name="kind" value={kind} />
      <FormField label="Group name" htmlFor={`${kind}-name`} required>
        <Input
          id={`${kind}-name`}
          name="name"
          required
          maxLength={80}
          placeholder={kind === 'team' ? 'Support' : 'VIP customers'}
        />
      </FormField>
      {kind === 'team' ? (
        <FormField label="Description" htmlFor="description">
          <Input id="description" name="description" maxLength={300} />
        </FormField>
      ) : (
        <FormField label="Colour" htmlFor="colour" hint="Any label, e.g. #16a34a or “green”.">
          <Input id="colour" name="colour" maxLength={20} />
        </FormField>
      )}
      <div className="flex items-end">
        <SubmitButton pendingLabel="Creating…">Create group</SubmitButton>
      </div>
      <div className="sm:col-span-3">
        <FormMessage state={state} okText="Group created." />
      </div>
    </form>
  );
}

/** Add a teammate to a team group. */
export function AddTeamMemberForm({
  groupId,
  options,
}: {
  groupId: string;
  options: Array<{ userId: string; email: string; role: string }>;
}) {
  const [state, action] = useFormState(addTeamMemberAction, initial);
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Everyone on your team is already in this group.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="min-w-[14rem] flex-1">
        <label htmlFor={`${groupId}-user`} className="mb-1 block text-xs text-muted-foreground">
          Add a teammate
        </label>
        {/* `company_admin` / `agent` are storage values; companyLabel turns them
            into the words the rest of the company panel uses ("Owner" / "Team
            member"). The submitted value is the user id and is untouched. */}
        <Select id={`${groupId}-user`} name="userId" size="sm">
          {options.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.email} ({companyLabel('role', o.role)})
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
        Add teammate to group
      </SubmitButton>
      <FormMessage state={state} okText="Added." className="basis-full" />
    </form>
  );
}

/** Add a lead to a contact group. */
export function AddContactMemberForm({
  groupId,
  options,
}: {
  groupId: string;
  options: Array<{ id: string; label: string }>;
}) {
  const [state, action] = useFormState(addContactMemberAction, initial);
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">No leads to add yet.</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="contactType" value="lead" />
      <div className="min-w-[14rem] flex-1">
        <label htmlFor={`${groupId}-contact`} className="mb-1 block text-xs text-muted-foreground">
          Add a contact
        </label>
        <Select id={`${groupId}-contact`} name="contactId" size="sm">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton size="sm" variant="outline" pendingLabel="Adding…">
        Add contact to group
      </SubmitButton>
      <FormMessage state={state} okText="Added." className="basis-full" />
    </form>
  );
}
