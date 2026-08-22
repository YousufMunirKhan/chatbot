import * as React from 'react';
import { cn } from '@/lib/utils';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * Standing notice block (Module 22).
 *
 * Replaces `src/components/info-banner.tsx` (which could only be amber) and the
 * eight files that hand-roll `bg-blue-50` notes. Each tone reads from the
 * semantic triplet in globals.css, so it is defined in both themes and its text
 * colour is contrast-checked against its own tinted surface.
 *
 * This is for content that is already on the page when it renders. For the
 * result of a form submission — which appears after the user acts, and so has
 * to be announced — use `FormMessage`, which carries the live region.
 */
const TONES: Record<AlertTone, string> = {
  info: 'border-info-border bg-info-bg text-info-fg',
  success: 'border-success-border bg-success-bg text-success-fg',
  warning: 'border-warning-border bg-warning-bg text-warning-fg',
  danger: 'border-danger-border bg-danger-bg text-danger-fg',
};

// `title` is omitted from the base attributes because the native one is the
// tooltip string; here it is the visible lead-in and so takes ReactNode.
export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  /** Optional bold lead-in above the body. */
  title?: React.ReactNode;
  /** Leading icon. Kept decorative — the copy must stand on its own. */
  icon?: React.ReactNode;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone = 'info', title, icon, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-md border px-4 py-3 text-sm', TONES[tone], className)}
      {...props}
    >
      <div className={cn(icon ? 'flex items-start gap-3' : undefined)}>
        {icon ? (
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
        </div>
      </div>
    </div>
  ),
);
Alert.displayName = 'Alert';

export { Alert };
