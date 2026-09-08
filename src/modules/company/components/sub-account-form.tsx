'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { cn } from '@/lib/utils';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { FIELD_GRID, FULL_ROW } from './form-layout';
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
    <form ref={ref} action={action} className={FIELD_GRID}>
      <FormField label="Business name" htmlFor="name" required>
        <Input id="name" name="name" required maxLength={120} />
      </FormField>
      <FormField label="Website" htmlFor="website">
        <Input
          id="website"
          name="website"
          type="url"
          inputMode="url"
          maxLength={200}
          placeholder="https://example.com"
        />
      </FormField>
      {/* Same column as the company profile's `default_language`, so the same
          wording: "Detect automatically" was a third phrasing of an option that
          resolves to English (src/lib/i18n/index.ts:38), and one of the three
          options was written in Arabic while the other two were in English. */}
      <FormField
        label="Dashboard language"
        htmlFor="defaultLanguage"
        hint="What language this client sees their own dashboard in. They can change it later."
      >
        <Select id="defaultLanguage" name="defaultLanguage" defaultValue="auto">
          <option value="auto">English (the default)</option>
          <option value="en">English</option>
          <option value="ar">Arabic — right-to-left</option>
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
      <div className={cn('space-y-3', FULL_ROW)}>
        <FormMessage state={state} okText="Sub-account created." />
        <SubmitButton pendingLabel="Creating…">Create sub-account</SubmitButton>
      </div>
    </form>
  );
}
