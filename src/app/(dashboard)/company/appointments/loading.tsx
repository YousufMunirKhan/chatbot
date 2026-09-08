import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/** Header, filter bar, one list — the shape the page settles into. */
export default function AppointmentsLoading() {
  return (
    <PageSkeleton className="max-w-7xl">
      <HeaderSkeleton />
      <div className="flex flex-wrap items-end gap-2">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-9 w-40 max-w-full" />
        <Skeleton className="h-9 w-20" />
      </div>
      <ListCardSkeleton rows={6} />
    </PageSkeleton>
  );
}
