import { Skeleton } from '@/components/ui/skeleton';
import { HeaderSkeleton, PageSkeleton, PanelSkeleton, StatGridSkeleton } from '../_skeletons';

export default function HelpDeskLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton withAction />
      <StatGridSkeleton count={4} className="md:grid-cols-4" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <PanelSkeleton lines={5} />
        <PanelSkeleton lines={3} />
      </div>
    </PageSkeleton>
  );
}
