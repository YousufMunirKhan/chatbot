'use client';

import { useFormState } from 'react-dom';
import { Alert } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { forgotPasswordAction, type ForgotPasswordState } from '../actions';

const initial: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, action] = useFormState(forgotPasswordAction, initial);

  return (
    <form action={action} className="space-y-4">
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

      {/* The failure is a single line, so it goes through `FormMessage`'s
          `role="alert"`. The success is two sentences and a next step, which a
          `<p>` cannot carry — so it is an `Alert` given the live region by
          hand, rather than the old `bg-emerald-50 text-emerald-700` box that
          announced nothing and did not exist in dark mode. */}
      <FormMessage state={{ error: state.error }} />
      {state.ok ? (
        <Alert tone="success" role="status" aria-live="polite" title="Check your email">
          If an account uses that address, a reset link is on its way. You can close this page — the
          link opens where it needs to. Nothing arriving? Check the spam folder, then try again.
        </Alert>
      ) : null}

      <SubmitButton size="lg" className="w-full" pendingLabel="Sending the link…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
