'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { signUpAction, type SignUpState } from '../actions';

const initialState: SignUpState = {};

export function SignUpForm() {
  const [state, formAction] = useFormState(signUpAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="space-y-5">
      <FormField label="Your name" htmlFor="name" required>
        <Input
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          placeholder="Alex Smith"
          className="h-12 rounded-xl"
        />
      </FormField>

      <FormField
        label="Work email"
        htmlFor="email"
        required
        hint="This becomes your sign-in and where we send account notices."
      >
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="alex@yourbusiness.com"
          className="h-12 rounded-xl"
        />
      </FormField>

      <FormField label="Password" htmlFor="password" required hint="At least 8 characters.">
        {/*
          The toggle sits inside the bordered row and the input loses its own
          border, so the pair reads as one control and the focus ring is drawn
          around both — the same treatment as the sign-in form.

          FormField wires accessibility onto whatever single element it is
          given, which here is this wrapper rather than the field itself. So the
          wrapper carries an id of its own (otherwise it would be handed
          `password` and collide with the input's), and the input points at the
          generated hint id directly, so the "at least 8 characters" rule is
          still read out on focus.
        */}
        <div
          id="password-control"
          className="flex rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring"
        >
          <Input
            id="password"
            aria-describedby="password-hint"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
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
      </FormField>

      <FormField
        label="Business name"
        htmlFor="companyName"
        required
        hint="What your customers know you as. You can change it later."
      >
        <Input
          name="companyName"
          type="text"
          autoComplete="organization"
          required
          maxLength={120}
          placeholder="Smith Plumbing"
          className="h-12 rounded-xl"
        />
      </FormField>

      <FormMessage state={state} />

      <SubmitButton
        className="h-12 w-full rounded-xl text-base font-bold shadow-lg shadow-blue-600/20"
        pendingLabel="Creating your account…"
      >
        Create account
      </SubmitButton>
    </form>
  );
}
