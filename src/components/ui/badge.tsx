import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const VARIANTS: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  success: 'border-transparent bg-emerald-100 text-emerald-800',
  warning: 'border-transparent bg-amber-100 text-amber-800',
  destructive: 'border-transparent bg-destructive/10 text-destructive',
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
