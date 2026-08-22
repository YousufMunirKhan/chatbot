'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createDataRequestAction, type ActionState } from '../settings-actions';

const initial: ActionState = {};

export function DataRequestForm() {
  const [state, action] = useFormState(createDataRequestAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Email" htmlFor="requesterEmail">
          <Input name="requesterEmail" type="email" required />
        </FormField>
        <FormField label="Request" htmlFor="requestType">
          <Select name="requestType">
            <option value="export">Export data</option>
            <option value="delete">Delete data</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Notes" htmlFor="notes">
        <Textarea name="notes" placeholder="Optional details about the request" rows={3} />
      </FormField>
      <FormMessage state={state} okText="Request submitted." />
      <SubmitButton pendingLabel="Submitting...">Submit request</SubmitButton>
    </form>
  );
}
