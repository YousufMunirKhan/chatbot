'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { inviteAgentAction, type ActionState } from '../actions';
import {
  AgentAccessFields,
  type AccessGroupOption,
  type AccessRoleOption,
} from './agent-access-fields';

const initial: ActionState = {};

/**
 * Invite somebody, at a role, with the access you choose (migration 0080).
 *
 * The role used to be a constant in the server action and a check constraint
 * that accepted one value, so this form had nothing to ask. It asks now, and the
 * tick list underneath says in plain words what the answer means — a role name
 * on its own tells an owner nothing about whether that person will be able to
 * open the bill.
 */
export function AgentInviteForm({
  roles,
  groups,
  manageable,
  defaultRole,
}: {
  roles: AccessRoleOption[];
  groups: AccessGroupOption[];
  manageable: string[];
  defaultRole: string;
}) {
  const [state, action] = useFormState(inviteAgentAction, initial);
  const defaults = roles.find((r) => r.value === defaultRole)?.defaults ?? [];

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="fullName">
          <Input name="fullName" placeholder="Agent name" />
        </FormField>
        <FormField label="Email" htmlFor="email" required>
          <Input name="email" type="email" required placeholder="agent@company.com" />
        </FormField>
      </div>

      <AgentAccessFields
        idPrefix="invite"
        roles={roles}
        groups={groups}
        manageable={manageable}
        initialRole={defaultRole}
        initialGranted={defaults.filter((key) => manageable.includes(key))}
      />

      <FormMessage
        state={state}
        okText="Invite sent. They set their own password from the email, and arrive with exactly the access you chose."
      />
      <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>
    </form>
  );
}
