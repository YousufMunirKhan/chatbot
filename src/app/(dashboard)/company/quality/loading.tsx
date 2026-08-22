import { HeaderSkeleton, PageSkeleton, PanelSkeleton, StatGridSkeleton } from '../_skeletons';

export default function QualityLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton withAction />
      <PanelSkeleton lines={2} />
      <StatGridSkeleton count={4} />
      <PanelSkeleton lines={3} />
      <PanelSkeleton lines={4} />
    </PageSkeleton>
  );
}
