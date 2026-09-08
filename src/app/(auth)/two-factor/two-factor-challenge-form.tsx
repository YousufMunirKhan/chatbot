'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { FormField } from '@/components/ui/form-field';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  verifyTwoFactorChallengeAction,
  type TwoFactorChallengeState,
} from './actions';

const EMPTY: TwoFactorChallengeState = {};

/**
 * One box for both kinds of code.
 *
 * A six-digit TOTP code and a `XXXXX-XXXXX` recovery code cannot be confused
 * for one another, so the server tells them apart by shape and this form does
 * not make somebody who has lost their phone hunt for a second link before they
 * can type anything. The toggle below only changes the label and the keyboard.
 */
export function TwoFactorChallengeForm() {
  const [state, action] = useFormState<TwoFactorChallengeState, FormData>(
    verifyTwoFactorChallengeAction,
    EMPTY,
  );
  const [usingRecovery, setUsingRecovery] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <FormField
        label={usingRecovery ? 'Recovery code' : 'Six-digit code'}
        htmlFor="two-factor-code"
        required
        hint={
          usingRecovery
            ? 'One of the codes you saved when you set this up. Each one works once.'
            : 'From your authenticator app. It changes every 30 seconds.'
        }
      >
        <Input
          id="two-factor-code"
          name="code"
          key={usingRecovery ? 'recovery' : 'totp'}
          inputMode={usingRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          placeholder={usingRecovery ? 'ABCDE-FGHIJ' : '123456'}
          maxLength={usingRecovery ? 13 : 7}
          required
        />
      </FormField>

      <FormMessage state={state} okText="" />
      <SubmitButton className="w-full" pendingLabel="Checking…">
        Continue
      </SubmitButton>

      <button
        type="button"
        className="w-full text-sm text-muted-foreground underline underline-offset-4"
        onClick={() => setUsingRecovery((value) => !value)}
      >
        {usingRecovery ? 'Use my authenticator app instead' : 'I do not have my phone'}
      </button>
    </form>
  );
}
