'use client';

import { useFormState } from 'react-dom';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { FormMessage } from '@/components/ui/form-message';
import { SubmitButton } from '@/components/ui/submit-button';
import { setCompanyStatusAction, type ActionState } from '../actions';

const initial: ActionState = {};

/**
 * Suspend / activate a live company (Module 4).
 *
 * Suspending stops a paying customer's assistant mid-conversation, so it goes
 * through `ConfirmSubmit` — which arms before it submits, and keeps no submit
 * button in the DOM until it is armed. Activating is recoverable, so it stays a
 * one-click button.
 */
export function CompanyStatusForm({
  companyId,
  companyName,
  isActive,
}: {
  companyId: string;
  companyName: string;
  isActive: boolean;
}) {
  const [state, action] = useFormState(setCompanyStatusAction, initial);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={isActive ? 'suspended' : 'active'} />
      {isActive ? (
        <ConfirmSubmit
          label="Suspend company"
          confirmLabel="Yes, suspend"
          pendingLabel="Suspending…"
          question={`${companyName}'s assistant stops answering immediately.`}
          idleVariant="destructive"
        />
      ) : (
        <SubmitButton size="sm" pendingLabel="Activating…">
          Activate company
        </SubmitButton>
      )}
      <p className="text-xs text-muted-foreground">
        {isActive
          ? 'Suspending also suspends the subscription, which is what actually stops AI replies.'
          : 'Activating restores the subscription too, so AI replies resume. A past-due or canceled subscription is left alone.'}
      </p>
      <FormMessage state={state} />
    </form>
  );
}
