import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant =
  | 'default'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive'
  | 'outline';

/**
 * Module 22: `success` and `warning` used to hardcode `bg-emerald-100` /
 * `bg-amber-100`, so they stayed light-mode when the shell went dark. Both now
 * sit on the semantic triplets in globals.css, which are defined for `:root`
 * and `.dark` and are contrast-checked against each other (the `-fg` value
 * clears 4.5:1 on its own `-bg`, not merely on the page background).
 *
 * `info` is new — eight files hand-roll `bg-blue-50` for it today. It is
 * deliberately cyan rather than the brand blue so "informational" stops
 * colliding with "selected".
 */
const VARIANTS: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  success: 'border-success-border bg-success-bg text-success-fg',
  warning: 'border-warning-border bg-warning-bg text-warning-fg',
  info: 'border-info-border bg-info-bg text-info-fg',
  destructive: 'border-danger-border bg-danger-bg text-danger-fg',
  outline: 'text-foreground',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
