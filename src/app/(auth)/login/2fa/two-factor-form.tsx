'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { verifyTwoFactorAction, type TwoFactorState } from '../../actions';

const initial: TwoFactorState = {};

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Verifying...' : 'Verify'}</Button>;
}

export function TwoFactorForm() {
  const [state, action] = useFormState(verifyTwoFactorAction, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">Verification code</Label>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
