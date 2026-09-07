'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { createSubAccountAction, type ActionState } from '../agency-actions';

const initial: ActionState = {};

/** Create a company under the signed-in user's agency. */
export function SubAccountForm() {
  const [state, action] = useFormState(createSubAccountAction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2">
      <FormField label="Business name" htmlFor="name" required>
        <Input id="name" name="name" required maxLength={120} />
      </FormField>
      <FormField label="Website" htmlFor="website">
        <Input id="website" name="website" maxLength={200} placeholder="https://" />
      </FormField>
      <FormField label="Language" htmlFor="defaultLanguage">
        <Select id="defaultLanguage" name="defaultLanguage" defaultValue="auto">
          <option value="auto">Detect automatically</option>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </Select>
      </FormField>
      <FormField label="Plan" htmlFor="plan">
        <Select id="plan" name="plan" defaultValue="starter">
          <option value="free_trial">Free trial</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="pro">Pro</option>
        </Select>
      </FormField>
      <div className="space-y-3 sm:col-span-2">
        <FormMessage state={state} okText="Sub-account created." />
        <SubmitButton pendingLabel="Creating…">Create sub-account</SubmitButton>
      </div>
    </form>
  );
}
