import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Loading placeholder (Module 22).
 *
 * `aria-hidden` by design: a skeleton is a picture of content that is not there
 * yet, and announcing a row of grey boxes helps nobody. Give the region that
 * contains them an `aria-busy="true"` instead, so assistive tech knows to wait.
 *
 * `tailwindcss-animate` supplies `animate-pulse`, so this needs no new
 * dependency.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';

export { Skeleton };
