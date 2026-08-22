import * as React from 'react';
import { cn } from '@/lib/utils';

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Current value. Clamped into `0…max` — callers do not have to pre-clamp. */
  value: number;
  max?: number;
  tone?: ProgressTone;
  /**
   * What the bar is measuring, for assistive tech. Required unless the bar is
   * already labelled by a visible element via `aria-labelledby`.
   */
  label?: string;
}

/**
 * Determinate progress bar (Module 22).
 *
 * Five copies of this markup exist. Two of them (billing, webhooks) clamp at the
 * source with `Math.min(100, …)`; the company Quality Room does not —
 * `src/app/(dashboard)/company/quality/page.tsx` computes
 * `Math.round((room.setupCompleted / room.setupTotal) * 100)` raw, so a company
 * whose completed count outruns its total gets a fill wider than its track and
 * a "112% ready" label. Clamping here means no call site can reintroduce it.
 *
 * None of the five copies is a `progressbar` to assistive tech — they are bare
 * divs, so the value is simply absent unless it also happens to be printed
 * beside them. This one carries the role and the value triplet.
 */
const TONES: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, tone = 'primary', label, ...props }, ref) => {
    const safeMax = max > 0 ? max : 100;
    const clamped = Math.min(safeMax, Math.max(0, Number.isFinite(value) ? value : 0));
    const percent = (clamped / safeMax) * 100;

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        {...props}
      >
        <div
          className={cn('h-full rounded-full transition-all', TONES[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
