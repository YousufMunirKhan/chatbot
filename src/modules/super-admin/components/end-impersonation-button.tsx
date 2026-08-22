'use client';

import { useEffect } from 'react';
import { useFormState } from 'react-dom';
import { SubmitButton } from '@/components/ui/submit-button';
import { endImpersonationAction, type ImpersonationState } from '../impersonation-actions';

const initial: ImpersonationState = {};

export function EndImpersonationButton() {
  const [state, action] = useFormState(endImpersonationAction, initial);

  // Full page load, not router.push — see the note in impersonation-actions.ts.
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <form action={action}>
      <SubmitButton variant="outline" size="sm" pendingLabel="Ending…">
        End impersonation
      </SubmitButton>
    </form>
  );
}
