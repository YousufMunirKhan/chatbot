'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ButtonSize = React.ComponentProps<typeof Button>['size'];

function Submit({ label, pendingLabel, size }: { label: string; pendingLabel: string; size: ButtonSize }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size={size} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Submit button for destructive form actions (Module 3 safety).
 *
 * Drop-in replacement for a bare `<Button type="submit">` inside a
 * `<form action={serverAction}>`: the first click only arms the control, and no
 * submit button exists in the DOM until it is armed — so a stray click, a
 * mis-tap on mobile, or a keyboard Enter cannot delete anything.
 *
 * Pass `typeToConfirm` for actions that are permanent and externally
 * consequential (a GDPR erasure): the confirm button stays disabled until the
 * word is typed exactly.
 */
export function ConfirmSubmit({
  label,
  confirmLabel = 'Yes, delete',
  pendingLabel = 'Working…',
  question = 'This cannot be undone.',
  typeToConfirm,
  size = 'sm',
  idleVariant = 'ghost',
}: {
  label: string;
  confirmLabel?: string;
  pendingLabel?: string;
  question?: string;
  typeToConfirm?: string;
  size?: ButtonSize;
  idleVariant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');

  if (!armed) {
    return (
      <Button type="button" variant={idleVariant} size={size} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }

  const ready = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* role="alert" so the consequence is ANNOUNCED when the control arms.
          Without it a screen-reader user just gets a silently-changed button. */}
      <span role="alert" className="text-xs text-muted-foreground">
        {question}
      </span>
      {typeToConfirm ? (
        <Input
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={typeToConfirm}
          aria-label={`Type ${typeToConfirm} to confirm`}
          className="h-9 w-32"
        />
      ) : null}
      {ready ? (
        <Submit label={confirmLabel} pendingLabel={pendingLabel} size={size} />
      ) : (
        <Button type="button" variant="destructive" size={size} disabled>
          {confirmLabel}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={() => {
          setArmed(false);
          setTyped('');
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
