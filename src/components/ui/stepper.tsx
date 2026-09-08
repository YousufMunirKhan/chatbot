import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StepStatus = 'complete' | 'current' | 'upcoming';

export interface StepperStep {
  /** Stable identity. Also the React key. */
  key: string;
  title: string;
  /** What this step actually asks of the user. `list` shows it; `rail` does not. */
  description?: React.ReactNode;
  status: StepStatus;
  /** Makes the step's title a link. `rail` never links — see below. */
  href?: string;
  /** A control for this row: usually the button that starts it. `list` only. */
  action?: React.ReactNode;
}

export interface StepperProps {
  steps: StepperStep[];
  /**
   * Names the sequence for screen readers, e.g. "Set-up checklist". Required:
   * an unnamed `<ol>` of five numbers announces as a list of five numbers.
   */
  label: string;
  /**
   * - `rail` — a compact one-line summary of where you are. Progress only.
   * - `list` — the checklist itself: number, title, what it involves, and the
   *   control that does it.
   */
  variant?: 'rail' | 'list';
  className?: string;
}

/**
 * Where the user is in a sequence they cannot finish in one sitting (Module 24).
 *
 * Two implementations of this exist, on two screens that describe the same five
 * steps: `StepRail` on the company home page (a row of pills) and `ChecklistRow`
 * on `/company/setup` (numbered rows with a button each). They agree on the
 * semantics — `aria-current="step"`, a tick for done, the success triplet for
 * the completed state — and disagree on every measurement: 7×7 circles against
 * `px-3 py-1` pills, `text-xs` against `text-sm`, a `Badge` in one and nothing
 * in the other. The customer-onboarding page draws a third — its markers were
 * `bg-emerald-100` / `bg-blue-100`, raw palette values with no dark-mode
 * definition, until a parallel pass moved them to `bg-primary`; that pass fixed
 * the colour and left a fourth set of measurements.
 *
 * This is those three, as one component with two densities.
 *
 * ## Rules it enforces, because they are the ones that get dropped
 *
 * **Colour is never the only signal.** A completed step is green AND carries a
 * tick AND says "Done"; the current step is emphasised AND carries
 * `aria-current="step"` AND says "Do this next". Someone who cannot separate the
 * green from the grey still knows where they are.
 *
 * **The number is decorative.** It is `aria-hidden`, because a screen reader
 * already announces "3 of 5" from the list itself, and hearing "three, three,
 * Connect your website" is worse than hearing it once.
 *
 * **The rail does not link.** It is a progress indicator; making pills tappable
 * invites a user to jump to step five before step one exists. `list` is the mode
 * that navigates, and it does so through a real button per row.
 *
 * Server component: this is progress, not interaction.
 */
const MARKER_TONES: Record<StepStatus, string> = {
  complete: 'border-success-border bg-success-bg text-success-fg',
  current: 'border-transparent bg-primary text-primary-foreground',
  upcoming: 'border-input text-muted-foreground',
};

const RAIL_TONES: Record<StepStatus, string> = {
  complete: 'border-success-border bg-success-bg text-success-fg',
  current: 'border-foreground/30 font-medium text-foreground',
  upcoming: 'border-input text-muted-foreground',
};

/** The tick or the number. Same box in both variants, so they line up. */
function StepMarker({
  status,
  index,
  className,
}: {
  status: StepStatus;
  index: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums',
        MARKER_TONES[status],
        className,
      )}
    >
      {status === 'complete' ? '✓' : index + 1}
    </span>
  );
}

export function Stepper({ steps, label, variant = 'list', className }: StepperProps) {
  if (steps.length === 0) return null;

  if (variant === 'rail') {
    return (
      // `flex-wrap`, not a scroller: five short pills wrap onto two lines at
      // 375px, and two lines of pills read fine. A horizontal scroller would hide
      // steps four and five behind a gesture nobody knows is available.
      <ol aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
        {steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.status === 'current' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              RAIL_TONES[step.status],
            )}
          >
            <span aria-hidden="true" className="tabular-nums">
              {step.status === 'complete' ? '✓' : index + 1}
            </span>
            {/* The state in words, for anyone the colour does not reach. It is
                `sr-only` in the rail because the rail's whole job is to be small
                — the visible version of this is in the `list` variant. */}
            <span className="sr-only">
              {step.status === 'complete'
                ? 'Done: '
                : step.status === 'current'
                  ? 'Do this next: '
                  : 'Not started: '}
            </span>
            <span>{step.title}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol aria-label={label} className={cn('divide-y', className)}>
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.status === 'current' ? 'step' : undefined}
          className={cn(
            // `sm:flex-row`, not `md:`/`lg:`: this list belongs inside a card,
            // and a card sits in a 360px sidebar as often as it spans a page.
            // Even `sm:` is a viewport question — if you place this in a narrow
            // column on a wide screen, pass `className="[&>li]:flex-col"` rather
            // than assuming the row fits.
            'flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4',
            step.status === 'current' && 'bg-muted/40',
          )}
        >
          <StepMarker status={step.status} index={index} className="sm:mt-0.5" />

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn(
                  'break-words font-medium leading-tight',
                  step.status === 'complete' && 'text-muted-foreground',
                )}
              >
                {step.href ? (
                  <Link
                    href={step.href}
                    className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {step.title}
                  </Link>
                ) : (
                  step.title
                )}
              </p>
              {step.status === 'complete' ? (
                <Badge variant="success">Done</Badge>
              ) : step.status === 'current' ? (
                <Badge variant="secondary">Do this next</Badge>
              ) : null}
            </div>
            {step.description ? (
              <p className="break-words text-sm text-muted-foreground">{step.description}</p>
            ) : null}
          </div>

          {/* `sm:shrink-0` and not plain `shrink-0`: below 640px this is a
              stacked column where the action gets a full-width line of its own,
              and pinning it to its content width there is what made the old
              hand-rolled version overflow on a phone. */}
          {step.action ? <div className="sm:shrink-0">{step.action}</div> : null}
        </li>
      ))}
    </ol>
  );
}
