'use client';

import * as React from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';

export interface SubmitButtonProps extends Omit<ButtonProps, 'type' | 'asChild'> {
  /** Label while the action is in flight. */
  pendingLabel?: React.ReactNode;
}

/**
 * Submit button that knows about its own form (Module 22).
 *
 * 49 files declare a local `Submit()` doing exactly this. Beyond the
 * duplication, the hand-rolled ones only set `disabled` — they never set
 * `aria-busy`, so a screen reader user hears the label change from "Save" to
 * "Saving…" with no indication that the control is now inert, and hears nothing
 * at all when it settles.
 *
 * Must be a client component: `useFormStatus` reads the pending state of the
 * nearest enclosing `<form>`, which only exists on the client. It still works
 * inside a server-rendered `<form action={serverAction}>` — the form itself
 * stays a server component, only this button hydrates.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
