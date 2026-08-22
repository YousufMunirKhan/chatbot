'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { topUpCompanyCreditAction, type ActionState } from '../actions';

const initial: ActionState = {};

/** Manual AI credit top-up, with the failure path actually rendered (Module 4). */
export function CreditTopUpForm({ companyId }: { companyId: string }) {
  const [state, action] = useFormState(topUpCompanyCreditAction, initial);

  return (
    <form action={action} className="space-y-3 rounded-md border bg-muted/20 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
        <FormField label="Top up (GBP)" htmlFor="creditTopUpAmount">
          <Input
            id="creditTopUpAmount"
            name="amount"
            type="number"
            min={0.01}
            step="0.01"
            placeholder="10.00"
            required
          />
        </FormField>
        <FormField label="Note" htmlFor="creditTopUpDescription">
          <Input
            id="creditTopUpDescription"
            name="description"
            placeholder="Invoice paid, bonus credit, or manual adjustment"
          />
        </FormField>
        <div className="flex items-end">
          <SubmitButton size="sm" pendingLabel="Adding…">
            Add credit
          </SubmitButton>
        </div>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
