import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * Marks the field as required. Renders the asterisk that 11 labels currently
   * hand-type into their own text (Module 22). The glyph is `aria-hidden`
   * because the control itself carries the real `required` attribute, and a
   * screen reader announcing "star" adds nothing over "required".
   */
  required?: boolean;
}

/**
 * `leading-tight`, not `leading-none` (Module 24).
 *
 * `leading-none` sets the line box to exactly the font size, which is fine for
 * the one-line case it was written for and collides the moment the label wraps —
 * the descenders of "Category" on line one land in the ascenders of line two.
 * Labels wrap constantly in this product: every two-column form, every card in a
 * 360px sidebar, and every screen at 375px. `leading-tight` (1.25) is the
 * smallest value that clears descenders at `text-sm`, so the single-line case
 * grows by 3.5px and the wrapped case stops overlapping.
 *
 * `block` because a bare `<label>` is inline: an inline label with a wrapped
 * second line does not honour the `space-y-1.5` rhythm `FormField` sets around
 * it, and its top margin collapses against whatever sits above.
 */
const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-sm font-medium leading-tight', className)}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="ms-0.5 text-danger-fg">
          *
        </span>
      ) : null}
    </label>
  ),
);
Label.displayName = 'Label';

export { Label };
