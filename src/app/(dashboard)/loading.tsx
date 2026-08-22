import { Skeleton } from '@/components/ui/skeleton';

/**
 * Fallback loading state for every dashboard route (Module 23).
 *
 * Next renders the nearest `loading.tsx` above a suspended segment, so this one
 * only appears where a route has not supplied its own — `company/` and
 * `super-admin/` have theirs. Without any file at this level, a slow page in a
 * segment that was missed shows the *previous* route's content frozen for the
 * whole server round-trip, which reads as a click that did nothing.
 *
 * It sits inside the shell: the layout, sidebar, header and impersonation
 * banner are all still rendered and interactive around it, so this only has to
 * stand in for `<main>`. The shape is the shape almost every screen in this
 * product has — a page heading, a row of stat tiles, a table-ish card — because
 * a skeleton that does not resemble what arrives is a second layout shift
 * rather than a defence against the first.
 *
 * `Skeleton` is `aria-hidden`; the announcement comes from the live region at
 * the bottom. Announcing a dozen grey boxes helps nobody.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* PageHeader: title + description */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      {/* The card that holds the screen's actual work */}
      <div className="rounded-lg border bg-card">
        <div className="space-y-1.5 p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="space-y-3 p-6 pt-0">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        Loading page…
      </p>
    </div>
  );
}
