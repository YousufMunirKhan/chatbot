'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inviteAgentAction, type ActionState } from '../actions';

const initial: ActionState = {};

function Invite() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Inviting…' : 'Add agent'}
    </Button>
  );
}

export function AgentInviteForm() {
  const [state, action] = useFormState(inviteAgentAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Name</Label>
          <Input id="fullName" name="fullName" placeholder="Agent name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email *</Label>
          <Input id="email" name="email" type="email" required placeholder="agent@company.com" />
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-600">Invite sent. The agent will set their password from email.</p> : null}
      <Invite />
    </form>
  );
}
