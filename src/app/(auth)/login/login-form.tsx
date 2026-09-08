'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { SubmitButton } from '@/components/ui/submit-button';
import { signInAction, type LoginState } from '../actions';

const initialState: LoginState = {};

/**
 * Sign in.
 *
 * Was a local `SubmitButton`, a hand-written `<Label>`+`<Input>` pair per field
 * and a bare `<p className="text-sm text-destructive">` for the failure — which
 * is not a live region, so a screen reader user pressed "Sign in", was told
 * nothing, and had no idea the password had been rejected. `FormField`,
 * `FormMessage` and `SubmitButton` are the versions of those three that carry
 * their accessibility with them.
 *
 * The `h-12 rounded-xl` overrides are gone: `Input` is `h-10 rounded-md`, which
 * is what the other 200-odd controls in the product are, and the one place a
 * bigger target genuinely helps — the submit button — is `size="lg"`.
 */
export function LoginForm() {
  const [state, formAction] = useFormState(signInAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Email address" htmlFor="email" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="owner@business.com"
        />
      </FormField>

      <FormField label="Password" htmlFor="password" required>
        <PasswordInput name="password" autoComplete="current-password" required />
      </FormField>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="h-4 w-4 rounded-sm border-input accent-primary"
        />
        Stay signed in on this device
      </label>

      <FormMessage state={state} okText="" />

      <SubmitButton size="lg" className="w-full" pendingLabel="Signing you in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
