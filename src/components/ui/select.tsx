import * as React from 'react';
import { cn } from '@/lib/utils';
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from './control-styles';

// `size` is omitted from the base attributes: the native select `size` is the
// number of visible rows, which nothing in this codebase uses, and reusing the
// name keeps the API identical to `Button`'s. Pass `rows` behaviour via
// `multiple` if a list-style select is ever needed.
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /**
   * `default` is the 40px control that matches `Input`; `sm` is the 36px one
   * used by the three filter bars (leads, orders, appointments) that already
   * run at `h-9`. Both come from `control-styles.ts`, so a `Select size="sm"`
   * and an `Input size="sm"` beside it are the same height by construction.
   */
  size?: ControlSize;
}

/**
 * Native `<select>`, styled to match `Input` (Module 22).
 *
 * Deliberately NOT Radix. 20 of the 84 selects in this codebase live in server
 * components inside `<form action={serverAction}>`, where the native element
 * submits its value for free and the page needs no JavaScript at all. A Radix
 * select is a client component backed by a hidden input, so adopting it would
 * force those 20 filter bars to hydrate to buy nothing — and it would mean a
 * new npm dependency, which this phase does not take. Native also gets the
 * platform picker on mobile and correct RTL flipping of the dropdown arrow for
 * free.
 *
 * ## The constraint that keeps getting broken: a select cannot truncate
 *
 * A native `<select>` renders its selected option as a single line the browser
 * paints itself. It will not wrap, it will not ellipsise, and `truncate` does
 * nothing to it — the text is simply cut mid-word at the control's edge. So the
 * width of the column decides whether the control is readable, and there is no
 * defensive class that saves it.
 *
 * This is the `lg:grid-cols-4` bug in its purest form: a form laid out with
 * `lg:` inside a ~500px column gave each field about 110px, and a select clipped
 * its own text. `lg:` measures the VIEWPORT, not the parent. If a select can sit
 * in a narrow column, lay the form out with `FieldGrid`, which measures the
 * container — and keep option labels short enough to survive the narrow case.
 *
 * ## Dark mode
 *
 * `text-foreground` is set explicitly rather than inherited. On Windows Chrome
 * an `<option>` inherits the select's `background-color` but takes its `color`
 * from the cascade, so a dark `--background` with no stated colour renders the
 * dropdown list as dark text on a dark sheet.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <select ref={ref} className={cn(CONTROL_BASE, CONTROL_SIZES[size], className)} {...props} />
  ),
);
Select.displayName = 'Select';

export { Select };
