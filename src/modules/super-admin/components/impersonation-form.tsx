'use client';

import { useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startImpersonationAction, type ImpersonationState } from '../impersonation-actions';

const initial: ImpersonationState = {};

function Start() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Switching…' : 'View as admin'}
    </Button>
  );
}

export function ImpersonationForm({ companyId }: { companyId: string }) {
  const [state, action] = useFormState(startImpersonationAction, initial);

  // Full page load, not router.push — see the note in impersonation-actions.ts.
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" name="reason" required minLength={8} placeholder="Support ticket, billing issue, setup help..." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="durationMinutes">Minutes</Label>
        <Input id="durationMinutes" name="durationMinutes" type="number" min={5} max={120} defaultValue={60} />
      </div>
      <div className="flex items-end">
        <Start />
      </div>
      {state.error ? <p className="text-sm text-destructive sm:col-span-3">{state.error}</p> : null}
    </form>
  );
}
