'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction, type ResetPasswordState } from '../actions';

const initial: ResetPasswordState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full rounded-xl shadow-lg shadow-blue-600/20" disabled={pending}>
      {pending ? 'Saving...' : 'Set new password'}
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useFormState(resetPasswordAction, initial);
  const [showPassword, setShowPassword] = useState(false);
  const type = showPassword ? 'text' : 'password';

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type={type} autoComplete="new-password" minLength={8} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input id="confirmPassword" name="confirmPassword" type={type} autoComplete="new-password" minLength={8} required />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} className="h-4 w-4" />
        Show password
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
