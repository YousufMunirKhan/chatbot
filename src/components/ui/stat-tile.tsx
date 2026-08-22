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
    <Card className={cn(href && 'transition-colors hover:bg-muted/50', className)}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className={cn('text-2xl font-semibold', TONES[tone])}>{value}</span>
          {delta ? <span className="text-xs font-medium">{delta}</span> : null}
        </div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
