'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAction, type LoginState } from '../actions';

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-12 w-full rounded-xl text-base font-bold shadow-lg shadow-blue-600/20" disabled={pending}>
      {pending ? 'Signing in...' : 'Sign in'}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="owner@business.com" className="h-12 rounded-xl" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="flex rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="h-12 border-0 shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="min-w-14 rounded-r-xl border-l px-3 text-sm font-medium text-slate-500 hover:bg-slate-50"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" name="remember" className="h-4 w-4" defaultChecked />
        Remember this device
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
