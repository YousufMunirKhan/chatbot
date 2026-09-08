'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The click-driven twin of `ConfirmSubmit`.
 *
 * `src/components/confirm-submit.tsx` guards every destructive action in the
 * product that happens through a `<form action={serverAction}>`: the first
 * click only arms the control, and no destructive button exists in the DOM
 * until it is armed, so a stray click or a mis-tap on a phone cannot delete
 * anything.
 *
 * A handful of destructive actions are not forms — they call a server action
 * from an `onClick` inside a `startTransition`. Those had no guard at all: one
 * tap on "Remove" and a flow trigger was gone from the database, with no
 * confirmation and no undo. This is the same two-step interaction for that
 * shape, with the same wording conventions, so the two read as one control
 * whichever way the action is wired.
 *
 * It lives here rather than in `components/ui` only because that directory is
 * not this pass's to change; it belongs beside `ConfirmSubmit`, and merging the
 * two is a five-line job for whoever owns that file next.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Yes, delete',
  question = 'This cannot be undone.',
  onConfirm,
  disabled,
  size = 'sm',
  className,
}: {
  label: string;
  confirmLabel?: string;
  /** What is about to happen, in the reader's terms. Announced when it arms. */
  question?: string;
  onConfirm: () => void;
  disabled?: boolean;
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {/* `role="alert"` so the consequence is ANNOUNCED the moment the control
          arms. Without it a screen-reader user gets a silently changed button
          and no idea what the second press will do. */}
      <span role="alert" className="text-xs text-muted-foreground">
        {question}
      </span>
      <Button
        type="button"
        variant="destructive"
        size={size}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size={size} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
