'use client';

import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { verifyTwoFactorAction, type TwoFactorState } from '../../actions';

const initial: TwoFactorState = {};

export function TwoFactorForm() {
  const [state, action] = useFormState(verifyTwoFactorAction, initial);

  return (
    <form action={action} className="space-y-4">
      <FormField
        label="Six-digit code"
        htmlFor="code"
        required
        hint="From the email we just sent you. Check the spam folder if it has not arrived."
      >
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="123456"
          required
          className="text-center font-mono text-base tracking-[0.3em] tabular-nums"
        />
      </FormField>

      {/* Was a bare `<p className="text-sm text-destructive">`: not a live
          region, so a wrong code was rejected in total silence for anyone
          using a screen reader. */}
      <FormMessage state={state} okText="" />

      <SubmitButton size="lg" className="w-full" pendingLabel="Checking…">
        Continue
      </SubmitButton>
    </form>
  );
}
