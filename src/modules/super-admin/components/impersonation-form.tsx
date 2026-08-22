'use client';

import { useEffect } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { startImpersonationAction, type ImpersonationState } from '../impersonation-actions';

const initial: ImpersonationState = {};

export function ImpersonationForm({ companyId }: { companyId: string }) {
  const [state, action] = useFormState(startImpersonationAction, initial);

  // Full page load, not router.push — see the note in impersonation-actions.ts.
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
      <input type="hidden" name="companyId" value={companyId} />
      <FormField label="Reason" htmlFor="reason">
        <Input id="reason" name="reason" required minLength={8} placeholder="Support ticket, billing issue, setup help..." />
      </FormField>
      <FormField label="Minutes" htmlFor="durationMinutes">
        <Input id="durationMinutes" name="durationMinutes" type="number" min={5} max={120} defaultValue={60} />
      </FormField>
      <div className="flex items-end">
        <SubmitButton variant="destructive" pendingLabel="Switching…">
          View as admin
        </SubmitButton>
      </div>
      <FormMessage state={state} className="sm:col-span-3" />
    </form>
  );
}
