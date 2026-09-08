'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SubmitButton } from '@/components/ui/submit-button';
import { signUpAction, type SignUpState } from '../actions';

const initialState: SignUpState = {};

export function SignUpForm() {
  const [state, formAction] = useFormState(signUpAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Your name" htmlFor="name" required>
        <Input
          name="name"
          type="text"
          autoComplete="name"
          autoFocus
          required
          maxLength={120}
          placeholder="Alex Smith"
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
        />
      </FormField>

      {/*
        `FormField` clones whatever single element it is handed and injects the
        `id`, the `aria-invalid` and the composed `aria-describedby` onto it.
        `PasswordInput` spreads its props straight onto the `<input>`, so that
        wiring lands on the real control and the "at least 8 characters" hint is
        read out on focus without this call site doing anything.

        It used to pass `id="password"` and `aria-describedby="password-hint"`
        by hand, which produced `aria-describedby="password-hint password-hint"`
        — the same hint announced twice.
      */}
      <FormField label="Password" htmlFor="password" required hint="At least 8 characters.">
        <PasswordInput
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
        />
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
        />
      </FormField>

      <FormMessage state={state} okText="" />

      <SubmitButton size="lg" className="w-full" pendingLabel="Creating your account…">
        Create account
      </SubmitButton>
    </form>
  );
}
