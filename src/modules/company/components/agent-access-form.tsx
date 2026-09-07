'use client';

import { useFormState } from 'react-dom';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateMemberAccessAction, type ActionState } from '../actions';
import {
  AgentAccessFields,
  type AccessGroupOption,
  type AccessRoleOption,
} from './agent-access-fields';

const initial: ActionState = {};

/**
 * Change what somebody already on the team can do.
 *
 * Inside a `<details>` rather than a dialog: the Team page is a table, an owner
 * opens this to check one person's access as often as to change it, and a
 * disclosure keeps the rest of the list visible while they compare. It also
 * costs no JavaScript to open, so the row stays usable while the page hydrates.
 *
 * There is no control here for changing your own access, and there is no error
 * message about it either — the page does not render this on the caller's own
 * row. The server refuses it regardless: that is where the rule lives.
 */
export function AgentAccessForm({
  membershipId,
  personLabel,
  roles,
  groups,
  manageable,
  currentRole,
  currentPermissions,
}: {
  membershipId: string;
  personLabel: string;
  roles: AccessRoleOption[];
  groups: AccessGroupOption[];
  manageable: string[];
  currentRole: string;
  currentPermissions: string[];
}) {
  const [state, action] = useFormState(updateMemberAccessAction, initial);

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-sm font-medium text-primary underline-offset-4 hover:underline">
        Change access
        <span className="sr-only"> for {personLabel}</span>
      </summary>
      <form action={action} className="mt-3 space-y-4 rounded-md border p-3 text-start">
        <input type="hidden" name="membershipId" value={membershipId} />
        <AgentAccessFields
          idPrefix={`member-${membershipId}`}
          roles={roles}
          groups={groups}
          manageable={manageable}
          initialRole={currentRole}
          initialGranted={currentPermissions}
        />
        <FormMessage state={state} okText="Saved. It applies the next time they load a page." />
        <SubmitButton pendingLabel="Saving…">Save access</SubmitButton>
      </form>
    </details>
  );
}
