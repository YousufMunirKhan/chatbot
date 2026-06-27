'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordAction, type ForgotPasswordState } from '../actions';

const initial: ForgotPasswordState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full rounded-xl shadow-lg shadow-blue-600/20" disabled={pending}>
      {pending ? 'Sending...' : 'Send reset link'}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useFormState(forgotPasswordAction, initial);

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="owner@business.com" />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          If that email exists, a password reset link has been sent.
        </p>
      ) : null}
      <SubmitButton />
      <Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
