'use client';

import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { addManualLeadAction, type ActionState } from '../leads-actions';

const initial: ActionState = {};

export function LeadForm() {
  const [state, action] = useFormState(addManualLeadAction, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="name" required>
          <Input name="name" required />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <Input name="email" type="email" />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <Input name="phone" />
        </FormField>
      </div>
      <FormField label="Message" htmlFor="message">
        <Textarea name="message" />
      </FormField>
      <FormMessage state={state} okText="Lead added." />
      <SubmitButton pendingLabel="Adding…">Add lead</SubmitButton>
    </form>
  );
}
