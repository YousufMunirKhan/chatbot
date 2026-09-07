'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { sendTicketCreatedTestAutomationAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Sending test...' : 'Send test ticket.created'}
    </Button>
  );
}

export function TicketAutomationTestButton() {
  const [state, action] = useFormState(sendTicketCreatedTestAutomationAction, initial);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton />
      {state.ok ? (
        <p className="text-xs text-emerald-700">
          Test sent. Check the latest delivery status below or in Webhooks.
        </p>
      ) : null}
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
