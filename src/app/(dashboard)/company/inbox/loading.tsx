import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/** The inbox keeps its own full-width app shell, so no `max-w-6xl` here. */
export default function InboxLoading() {
  return (
    <PageSkeleton className="max-w-none space-y-4">
      <HeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-9 w-72 max-w-full" />
          <ListCardSkeleton rows={8} />
        </div>
      </div>
    </PageSkeleton>
  );
}
