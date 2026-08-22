import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, PageSkeleton, PanelSkeleton, StatGridSkeleton } from '../_skeletons';

export default function BusinessDataLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton withAction />
      <StatGridSkeleton count={5} className="lg:grid-cols-5" />
      <Skeleton className="h-10 w-full" />
      <PanelSkeleton lines={4} />
    </PageSkeleton>
  );
}
