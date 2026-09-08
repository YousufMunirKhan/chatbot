'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from './input';

/**
 * A password field with a reveal control.
 *
 * It is ONE input with the button laid over it, not an input and a button
 * inside a bordered flex row. That earlier shape looked fine empty and broke as
 * soon as a browser filled it in: `Input` carries its own `rounded-md`, the
 * wrapper was `rounded-xl`, and only the border was overridden — so the control
 * had two different corner radii, one inside the other. Autofill paints the
 * `<input>` element and nothing else, so the filled colour stopped short of the
 * wrapper's corners and the field read as clipped. It was also built twice, in
 * two files, with a third screen offering a checkbox instead.
 *
 * The padding on the right is what reserves room for the button; the button
 * itself never overlaps the text because the input will not run under it.
 * `pe-16` (64px) is measured against the visible words — "Show" and "Hide" at
 * `text-sm` inside `px-3` come to about 62px. The visible words are NOT
 * translated and NOT taken from `revealLabel`, which is the accessible name
 * only; if that ever changes, this reservation has to change with it.
 *
 * The reveal control is in the tab order (Module 24). It used to carry
 * `tabIndex={-1}`, which is the shortcut people reach for so that Tab goes
 * straight from the password to the submit button — but revealing the password
 * is functionality, and functionality a mouse can reach and a keyboard cannot is
 * a WCAG 2.1.1 failure. It is also the one control on a login form that a user
 * who has just mistyped a password most needs. `aria-pressed` reports its state,
 * so a screen-reader user hears "Show password, toggle button, pressed".
 */
// Built on `InputProps`, not on the raw HTML attributes: that is what carries
// the `default`/`sm` size variant through, and what keeps the native numeric
// `size` out — the two `size` meanings would otherwise collide here.
export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** Label for the reveal control, if the default reads oddly in context. */
  revealLabel?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, revealLabel, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pe-16', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // `inset-y-px` and `end-px` keep the button inside the input's own
          // border rather than sitting on top of it, so the focus ring stays a
          // single unbroken outline around the whole control.
          //
          // `rounded-e-md`, not `rounded-e-[inherit]`. `border-radius: inherit`
          // takes the PARENT's computed radius, and the parent here is the bare
          // `relative` wrapper, which has none — so it resolved to 0 and the
          // button's focus ring drew a square corner over the input's rounded
          // one. `md` is `Input`'s own radius, stated once here rather than
          // inherited from an element that deliberately has no box of its own.
          className={cn(
            'absolute inset-y-px end-px flex items-center rounded-e-md px-3',
            'text-sm font-medium text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={visible ? 'Hide password' : (revealLabel ?? 'Show password')}
          aria-pressed={visible}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
