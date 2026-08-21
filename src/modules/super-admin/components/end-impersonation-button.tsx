'use client';

import { useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { endImpersonationAction, type ImpersonationState } from '../impersonation-actions';

const initial: ImpersonationState = {};

function End() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Ending…' : 'End impersonation'}
    </Button>
  );
}

export function EndImpersonationButton() {
  const [state, action] = useFormState(endImpersonationAction, initial);

  // Full page load, not router.push — see the note in impersonation-actions.ts.
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <form action={action}>
      <End />
    </form>
  );
}
