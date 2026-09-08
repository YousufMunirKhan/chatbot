import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, ListCardSkeleton, PageSkeleton, StatGridSkeleton } from '../_skeletons';

/**
 * Reports is the slowest page in the company panel — every tab runs a fan-out
 * of range-scoped aggregates — and it was inheriting the home board's skeleton,
 * which is a narrow column with three tiles. The real page is a wide one with a
 * range picker, a tab rail, four tiles and a stack of cards, so this stands in
 * for that instead.
 */
export default function ReportsLoading() {
  return (
    <PageSkeleton className="max-w-7xl">
      <HeaderSkeleton withAction />
      {/* Range presets, then the custom-dates panel. */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
      {/* The tab rail. */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-28" />
        ))}
      </div>
      <StatGridSkeleton count={4} />
      <ListCardSkeleton rows={5} />
    </PageSkeleton>
  );
}
