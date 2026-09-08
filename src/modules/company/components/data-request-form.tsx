'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createDataRequestAction, type ActionState } from '../settings-actions';
import { FIELD_GRID } from './form-layout';

const initial: ActionState = {};

export function DataRequestForm() {
  const [state, action] = useFormState(createDataRequestAction, initial);
  return (
    <form action={action} className="space-y-4">
      {/* Three labels of one word each — "Email", "Request", "Notes" — on a form
          that starts an irreversible deletion. Nothing said whose email, what
          the two options actually do, or that this is you logging a request a
          customer made to you rather than making one yourself. Required was
          enforced on the input and never marked on the label. */}
      <div className={FIELD_GRID}>
        <FormField
          label="Customer’s email address"
          htmlFor="requesterEmail"
          required
          hint="The address they gave you. Everything held against it is what gets exported or erased."
        >
          <Input
            name="requesterEmail"
            type="email"
            required
            autoComplete="off"
            placeholder="customer@example.com"
          />
        </FormField>
        <FormField
          label="What they asked for"
          htmlFor="requestType"
          required
          hint="Erasing is permanent — their chats and details cannot be recovered afterwards."
        >
          <Select name="requestType">
            <option value="export">Send them a copy of their data</option>
            <option value="delete">Erase their data permanently</option>
          </Select>
        </FormField>
      </div>
      <FormField
        label="Notes"
        htmlFor="notes"
        hint="Optional, and only your team sees it. Worth recording how they asked and when, in case you are ever asked to show it."
      >
        <Textarea
          name="notes"
          placeholder="Asked by email on 3 March, identity confirmed by phone."
          rows={3}
        />
      </FormField>
      <FormMessage state={state} okText="Logged. It appears below until you act on it." />
      {/* "Submit request" read as though pressing it did the thing. It does not:
          it files the request for someone to action from the list below. */}
      <SubmitButton pendingLabel="Logging…">Log this request</SubmitButton>
    </form>
  );
}
