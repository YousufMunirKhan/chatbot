import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The shape every server action in this codebase already returns.
 * Structural, not a shared import, so it matches each module's own state type
 * without those modules having to depend on this file.
 */
export interface FormMessageState {
  ok?: boolean;
  error?: string | null;
}

export interface FormMessageProps {
  /** The `useFormState` value. `undefined` renders nothing. */
  state: FormMessageState | undefined | null;
  /** Success copy. The 46 hand-rolled versions mostly say "Saved." */
  okText?: React.ReactNode;
  className?: string;
}

/**
 * Form submission result (Module 22).
 *
 * 46 files hand-roll this pair today, in two different greens
 * (`text-emerald-600` at 3.76:1 and `text-green-600` at 3.30:1 — both fail AA),
 * and **there are zero live regions in the entire repo**. That last part is the
 * real bug: a server action completes, the message appears, and a screen reader
 * user is told nothing at all. The form looks to them exactly as it did before
 * they pressed the button.
 *
 * So the two states are announced differently, matching what they mean:
 *  - success uses `role="status"` + `aria-live="polite"`, which waits for a gap
 *    in speech rather than cutting the user off;
 *  - failure uses `role="alert"`, which is assertive, because the user is about
 *    to move on believing the save worked.
 *
 * Both branches render the same element in the same place, so the region is
 * present in the DOM from first paint and assistive tech is already watching it
 * when the content swaps in.
 */
export function FormMessage({ state, okText = 'Saved.', className }: FormMessageProps) {
  const error = state?.error;
  const ok = Boolean(state?.ok) && !error;

  return (
    <p
      role={error ? 'alert' : 'status'}
      aria-live={error ? undefined : 'polite'}
      className={cn(
        'text-sm empty:hidden',
        error ? 'text-danger-fg' : 'text-success-fg',
        className,
      )}
    >
      {error ? error : ok ? okText : null}
    </p>
  );
}
