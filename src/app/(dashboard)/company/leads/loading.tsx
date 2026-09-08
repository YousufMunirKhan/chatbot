import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/**
 * Without this file the nearest `loading.tsx` above is `company/loading.tsx` —
 * the home board's shape: a narrow column, one panel and three stat tiles.
 * Enquiries is a wide list with a filter bar and no tiles at all, so the reader
 * watched a skeleton that resembled nothing arrive and then jump. A skeleton of
 * the wrong shape is a second layout shift, not a defence against the first.
 */
export default function LeadsLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton withAction />
      {/* The filter bar: two labelled controls and two buttons. */}
      <div className="flex flex-wrap items-end gap-2">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-9 w-40 max-w-full" />
        <Skeleton className="h-9 w-20" />
      </div>
      <ListCardSkeleton rows={6} />
    </PageSkeleton>
  );
}
