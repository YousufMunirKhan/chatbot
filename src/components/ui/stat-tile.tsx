import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface StatTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Secondary line under the value. */
  hint?: React.ReactNode;
  /** Turns the whole tile into a link, with the hover treatment. */
  href?: string;
  /** Colours the value only — the label stays muted so the grid still scans. */
  tone?: StatTone;
  /** Trend chip beside the value, e.g. a `Badge` or an arrow + percentage. */
  delta?: React.ReactNode;
  className?: string;
}

/**
 * Single metric in a dashboard stat grid (Module 22).
 *
 * Six local clones exist (`Stat` in the company overview, the quick-action
 * analytics page, super-admin overview, super-admin quality and the company
 * manage page; `Metric` in company usage and the super-admin company detail
 * page). They agree on the shape — muted uppercase label, large semibold value
 * — and differ only in which extras they happen to support: one has `href`, one
 * has `hint`, none has a trend slot. This is the union.
 */
const TONES: Record<StatTone, string> = {
  default: '',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
};

export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'default',
  delta,
  className,
}: StatTileProps) {
  const body = (
    // `h-full` so a row of tiles is one height when one of them has a two-line
    // label and its neighbours do not. A grid stretches its items by default;
    // wrapping the tile in a `<Link>` broke that, because the stretched element
    // was then the link and the Card inside it shrank to its own content.
    <Card className={cn('h-full', href && 'transition-colors hover:bg-muted/50', className)}>
      <CardContent className="p-4">
        {/* `break-words` on both, and `tabular-nums` on the value: these are
            numbers rendered at `text-2xl` inside grid tracks that get down to
            about 150px on a phone, and a formatted count like "1,284,003" has
            no break opportunity in it. Without this the value pushes the tile
            wider than its track and the page scrolls sideways. */}
        <p className="break-words text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
          <span className={cn('break-words text-2xl font-semibold tabular-nums', TONES[tone])}>
            {value}
          </span>
          {delta ? <span className="text-xs font-medium">{delta}</span> : null}
        </div>
        {hint ? <p className="mt-1 break-words text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );

  return href ? (
    // The linked tile had NO focus indicator: the ring lives on `Card`'s
    // children, not on the `<Link>` wrapping it, so a keyboard user tabbing
    // through a stat grid saw the page do nothing at all. `rounded-lg` matches
    // the card underneath so the ring traces the shape you can see.
    <Link
      href={href}
      className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
