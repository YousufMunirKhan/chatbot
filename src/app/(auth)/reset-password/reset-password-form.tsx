'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { PasswordInput } from '@/components/ui/password-input';
import { SubmitButton } from '@/components/ui/submit-button';
import { resetPasswordAction, type ResetPasswordState } from '../actions';

const initial: ResetPasswordState = {};

/**
 * Set a new password.
 *
 * This was the third hand-rolled reveal control in the codebase and the odd one
 * out: instead of a button on the field it was a `Show password` checkbox below
 * both fields, driven by local state, flipping `type` on two inputs at once. So
 * the same job — "let me see what I typed" — looked like three different
 * features depending on which screen you were on, and this one put the control
 * somewhere no browser or password manager expects it.
 *
 * `PasswordInput` is that control, once. Each field now reveals independently,
 * which is what someone comparing two boxes actually wants.
 */
export function ResetPasswordForm() {
  const [state, action] = useFormState(resetPasswordAction, initial);

  return (
    <form action={action} className="space-y-4">
      <FormField label="New password" htmlFor="password" required hint="At least 8 characters.">
        <PasswordInput name="password" autoComplete="new-password" minLength={8} required />
      </FormField>

      <FormField label="Confirm new password" htmlFor="confirmPassword" required>
        <PasswordInput
          name="confirmPassword"
          autoComplete="new-password"
          minLength={8}
          required
          revealLabel="Show confirmation"
        />
      </FormField>

      <FormMessage state={state} okText="" />

      <SubmitButton size="lg" className="w-full" pendingLabel="Saving your password…">
        Set new password
      </SubmitButton>
    </form>
  );
}
