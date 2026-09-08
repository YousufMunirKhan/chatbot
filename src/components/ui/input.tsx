import * as React from 'react';
import { cn } from '@/lib/utils';
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from './control-styles';

// `size` is omitted from the base attributes for the same reason `Select` omits
// it: the native input `size` is a character count that nothing in this codebase
// uses (grep says zero call sites), and reusing the name keeps one size scale
// across `Button`, `Input`, `Select` and `Textarea`. If a native character width
// is ever genuinely needed, set it with a `w-` class instead.
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /**
   * `default` is the 40px control; `sm` is the 36px one.
   *
   * `sm` exists because the filter bars ran at 36px and `Input` was fixed at
   * 40px with no variant, so `src/modules/company/components/list-controls.tsx`
   * kept a hand-written `inputCls` — its own comment says it was "the one
   * control that could not adopt its primitive" — and the reports page hand-rolls
   * two more. A search box 4px taller than the Select and the Button beside it is
   * why those bars never lined up.
   */
  size?: ControlSize;
}

/**
 * Single-line text control (Module 22; sizes and error state, Module 24).
 *
 * ## The composition constraint — read this before wrapping it
 *
 * This element bakes in its own `h-*`, `rounded-md`, `border` and focus ring.
 * That is deliberate: it is the control, not a piece of one. The failure mode is
 * putting it INSIDE another bordered, rounded box to bolt something on the end —
 * you then have two radii, one inside the other, and the inner one is the only
 * thing a browser autofill paints. That is exactly how the password field broke;
 * `password-input.tsx` is the fixed pattern and the one to copy:
 *
 *   - the wrapper is `relative` and carries **no** border, background or radius;
 *   - the trailing control is `absolute inset-y-px end-px`, so it sits inside
 *     this element's own border and the focus ring stays one unbroken outline;
 *   - room for it is reserved with `pe-*` on the input, not by shrinking it.
 *
 * If you need a bordered group (a segmented control, an input with an attached
 * unit), do not build it out of `Input` — the two radii will find you.
 *
 * ## Error state
 *
 * `aria-invalid` now paints as well as announces. `FormField` sets it whenever
 * it is given an `error`, so any field wrapped in a `FormField` gets a red border
 * and a red focus ring for free; nothing at the call site opts in. The variant is
 * registered in `tailwind.config.ts` (it is not one of Tailwind's built-in nine).
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = 'default', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(CONTROL_BASE, CONTROL_SIZES[size], className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
