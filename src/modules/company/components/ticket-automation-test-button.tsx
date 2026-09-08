'use client';

import { useFormState } from 'react-dom';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { sendTicketCreatedTestAutomationAction } from '../helpdesk-actions';
import type { ActionState } from '../actions';

const initial: ActionState = {};

export function TicketAutomationTestButton() {
  const [state, action] = useFormState(sendTicketCreatedTestAutomationAction, initial);
  return (
    <form action={action} className="space-y-2">
      {/* Was a local `SubmitButton` — the 49th copy of the same seven lines,
          and like all of them it set `disabled` without `aria-busy`, so a
          screen-reader user heard the label change and was never told the
          control had gone inert. */}
      {/* "Send test ticket.created" named the event payload rather than the
          outcome. The surrounding card already explains that ticket.created is
          what leaves the dashboard; the button says what pressing it does. */}
      <SubmitButton size="sm" variant="outline" pendingLabel="Sending test…">
        Send a test ticket alert
      </SubmitButton>
      {/* Was a raw `text-emerald-700` paragraph plus a `text-destructive` one,
          neither of them a live region — the whole point of a test button is
          that it reports back, and it reported back to nobody using a screen
          reader. */}
      <FormMessage
        state={state}
        className="text-xs"
        okText="Test sent. Check the latest delivery status below, or on the Webhooks page."
      />
    </form>
  );
}
