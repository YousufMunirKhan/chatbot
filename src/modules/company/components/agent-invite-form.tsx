'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { inviteAgentAction, type ActionState } from '../actions';

const initial: ActionState = {};

export function AgentInviteForm() {
  const [state, action] = useFormState(inviteAgentAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Name" htmlFor="fullName">
          <Input name="fullName" placeholder="Agent name" />
        </FormField>
        <FormField label="Email" htmlFor="email" required>
          <Input name="email" type="email" required placeholder="agent@company.com" />
        </FormField>
      </div>
      <FormMessage
        state={state}
        okText="Invite sent. The agent will set their password from email."
      />
      <SubmitButton pendingLabel="Inviting…">Add agent</SubmitButton>
    </form>
  );
}
