import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders for the company routes (Module 22).
 *
 * Every page under `/company` is an async server component running four to six
 * parallel Supabase queries, and there were **no** `loading.tsx` files anywhere
 * in the app — so every navigation was a dead click: the old page stayed on
 * screen with no acknowledgement until the slowest query returned.
 *
 * The `_` prefix keeps this file out of the router; it is a shared module, not
 * a route. Each `loading.tsx` composes these three pieces rather than
 * hand-rolling its own grey boxes, so the six of them are six lines each.
 *
 * `Skeleton` is `aria-hidden`, so the wrapper carries `aria-busy="true"` and a
 * visually hidden "Loading…" — the boxes are a picture of absent content, and
 * announcing a grid of them helps nobody, but silence helps nobody either.
 */
export function PageSkeleton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={cn('mx-auto max-w-6xl space-y-6', className)}>
      <span className="sr-only" role="status">
        Loading…
      </span>
      {children}
    </div>
  );
}

/** Matches `PageHeader`: a 2xl title and one line of description. */
export function HeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {withAction ? <Skeleton className="h-10 w-36" /> : null}
    </div>
  );
}

/** Matches a `StatTile` grid: label line, value line, inside a `p-4` card. */
export function StatGridSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Matches a `<Card><CardContent className="p-0">` wrapping a table or list —
 * the shape 31 of the 50 tables in this product use.
 */
export function ListCardSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="h-4 w-12 shrink-0" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Matches a padded card with a heading and a few body lines. */
export function PanelSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-6">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
