import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { SetupStep } from '@/modules/company/setup-data';
import { GUIDE_DONE, guideHref, type GuideScreen } from '../guide-content';

/**
 * The frame every guided-setup screen sits in.
 *
 * WHY A FRAME AT ALL
 * ------------------
 * `/company/setup` is a checklist: every row and every button visible at once.
 * That answers "what is left?" and it is the right page for coming back to. It
 * is the wrong shape for somebody's first ten minutes, where a whole list on one
 * screen is a whole list of decisions at once and the honest response is to
 * close the tab.
 *
 * So this is the same steps, one at a time, with the three things a person needs
 * in order to keep going: where they are (the rail and the bar), a way back
 * (every earlier step is a link, and so is the checklist), and a way past (skip,
 * stated with its cost). Nothing here computes progress — it is handed `steps`
 * from `getCompanySetupProgress()`, so the guide and the checklist can never
 * disagree about what is finished.
 *
 * LAYOUT
 * ------
 * The rail is `xl:` and not `lg:` on purpose. This page renders inside the
 * dashboard shell, whose sidebar is a fixed `w-64` from `md` up — so at a
 * 1024px viewport the content column is about 720px, and a 256px rail taken out
 * of that leaves 440px for the screen itself. Tailwind's breakpoints measure the
 * viewport, not this column, so `lg:` would be measuring the wrong thing. At
 * `xl` the column is about 976px and the rail costs nothing.
 */

export interface GuideShellProps {
  steps: SetupStep[];
  /** Which screen is showing. `done` is the finish screen, outside the count. */
  current: GuideScreen;
  /** How many of the five `steps` are finished, from the setup progress. */
  complete: number;
  /** Right of the "Step 3 of 5" line — the time estimate, usually. */
  meta?: React.ReactNode;
  children: React.ReactNode;
}

function StepDot({
  index,
  state,
}: {
  index: number;
  state: 'done' | 'current' | 'todo';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        state === 'done' && 'border-success-border bg-success-bg text-success-fg',
        state === 'current' && 'border-transparent bg-primary text-primary-foreground',
        state === 'todo' && 'text-muted-foreground',
      )}
    >
      {state === 'done' ? '✓' : index + 1}
    </span>
  );
}

export function GuideShell({ steps, current, complete, meta, children }: GuideShellProps) {
  const total = steps.length;
  const currentIndex = steps.findIndex((step) => step.key === current);
  const position = current === GUIDE_DONE ? total : currentIndex + 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ---------------------------------------------------------------- */}
      {/* Where you are. Present on every screen, at every width, because a  */}
      {/* wizard that hides its own length is why people stop halfway.       */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link
            href="/company/setup"
            className="rounded-sm text-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="dir-arrow" aria-hidden="true">
              ←
            </span>{' '}
            {/* Counted rather than spelled. This said "All five steps" and went
                stale the moment the website step was added in front of them. */}
            All {total} steps
          </Link>
          <p className="text-sm text-muted-foreground">
            {current === GUIDE_DONE ? (
              <>Setup finished</>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  Step {position} of {total}
                </span>
                {meta ? <> · {meta}</> : null}
              </>
            )}
          </p>
        </div>
        <Progress
          value={complete}
          max={total}
          tone={complete === total ? 'success' : 'primary'}
          label={`${complete} of ${total} setup steps finished`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
        {/* -------------------------------------------------------------- */}
        {/* The rail: the whole journey, always readable, every earlier and  */}
        {/* later step reachable. Below `xl` it collapses to the row of dots */}
        {/* underneath, which keeps the position without eating the width.   */}
        <nav aria-label="Setup steps" className="hidden xl:block">
          <ol className="space-y-1">
            {steps.map((step, index) => {
              const isCurrent = step.key === current;
              return (
                <li key={step.key}>
                  <Link
                    href={guideHref(step.key as GuideScreen)}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cn(
                      'flex items-start gap-3 rounded-md p-2.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      isCurrent ? 'bg-muted font-medium' : 'hover:bg-muted/60',
                    )}
                  >
                    <StepDot
                      index={index}
                      state={step.complete ? 'done' : isCurrent ? 'current' : 'todo'}
                    />
                    <span className="min-w-0">
                      <span className="block">{step.title}</span>
                      {step.complete ? (
                        <span className="mt-0.5 block text-xs text-success-fg">Done</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 space-y-5">
          {/* The compact stepper. Numbers only, so the whole list fits one row
              at 375px inside the dashboard's own padding — six 24px dots and
              their gaps come to 184px of the ~343px available, so there is
              still headroom for a seventh. No wrap, and no horizontal scroll on
              the page body. Each is a link with a real accessible name, so
              "step 3" is never a bare dot to guess at. */}
          <nav aria-label="Setup steps" className="xl:hidden">
            <ol className="flex items-center gap-2">
              {steps.map((step, index) => {
                const isCurrent = step.key === current;
                return (
                  <li key={step.key} className="min-w-0 flex-1">
                    <Link
                      href={guideHref(step.key as GuideScreen)}
                      aria-current={isCurrent ? 'step' : undefined}
                      className="flex flex-col items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <StepDot
                        index={index}
                        state={step.complete ? 'done' : isCurrent ? 'current' : 'todo'}
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-1 w-full rounded-full',
                          step.complete ? 'bg-success' : isCurrent ? 'bg-primary' : 'bg-muted',
                        )}
                      />
                      <span className="sr-only">
                        {step.title}
                        {step.complete ? ' — done' : ''}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>

          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The bar at the bottom of a guided screen: back, skip, and the one primary
 * thing to do.
 *
 * `primary` is last in the DOM and last visually in LTR, and the whole row
 * wraps rather than shrinking — at 375px the three controls stack full-width
 * instead of squeezing a button label to two characters.
 */
export function GuideFooter({
  back,
  skip,
  primary,
}: {
  back?: React.ReactNode;
  skip?: React.ReactNode;
  primary: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">{back}</div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {skip}
        {primary}
      </div>
    </div>
  );
}
