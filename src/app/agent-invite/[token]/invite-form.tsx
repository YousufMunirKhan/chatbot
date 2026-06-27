'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { acceptAgentInviteAction, type AcceptInviteState } from './actions';

const initial: AcceptInviteState = {};

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Creating account...' : 'Set password'}</Button>;
}

export function InviteAcceptForm({ token }: { token: string }) {
  const [state, action] = useFormState(acceptAgentInviteAction, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Submit />
    </form>
  );
}
