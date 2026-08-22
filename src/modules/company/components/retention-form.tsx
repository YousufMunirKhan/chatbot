'use client';

import { useFormState } from 'react-dom';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { updateRetentionAction, type ActionState } from '../settings-actions';

const initial: ActionState = {};

export function RetentionForm({ current }: { current: number }) {
  const [state, action] = useFormState(updateRetentionAction, initial);

  return (
    <form action={action} className="space-y-4">
      <FormField label="Retention period (days)" htmlFor="retentionDays">
        {/* `max-w-xs` is this one select's own width cap, kept from the local
            `selectCls` it replaced. */}
        <Select name="retentionDays" className="max-w-xs" defaultValue={current}>
          {[30, 60, 90, 180, 365, 730, 1095].includes(current) ? null : (
            <option value={current}>{current} days</option>
          )}
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>6 months</option>
          <option value={365}>1 year</option>
          <option value={730}>2 years</option>
          <option value={1095}>3 years</option>
        </Select>
      </FormField>
      <FormMessage state={state} />
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
