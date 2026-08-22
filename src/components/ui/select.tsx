import * as React from 'react';
import { cn } from '@/lib/utils';

// `size` is omitted from the base attributes: the native select `size` is the
// number of visible rows, which nothing in this codebase uses, and reusing the
// name keeps the API identical to `Button`'s. Pass `rows` behaviour via
// `multiple` if a list-style select is ever needed.
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /**
   * `default` is the 40px control that matches `Input`; `sm` is the 36px one
   * used by the three filter bars (leads, orders, appointments) that already
   * run at `h-9`.
   */
  size?: 'default' | 'sm';
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
 * `border-input` rather than the bare `border` that most existing selects use:
 * `--border` is decorative and sits at 1.23:1, while `--input` is now held to
 * 3:1 because the border is the only thing telling the user a control is there.
 */
const SIZES: Record<NonNullable<SelectProps['size']>, string> = {
  default: 'h-10 py-2',
  sm: 'h-9 py-1',
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

export { Select };
