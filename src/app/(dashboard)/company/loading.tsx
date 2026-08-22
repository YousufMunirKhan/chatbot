import { HeaderSkeleton, PageSkeleton, PanelSkeleton, StatGridSkeleton } from './_skeletons';

/** Company home: the title, the single next-action card, then the signal row. */
export default function CompanyOverviewLoading() {
  return (
    <PageSkeleton className="max-w-4xl">
      <HeaderSkeleton />
      <PanelSkeleton lines={2} />
      <StatGridSkeleton count={3} className="sm:grid-cols-3 lg:grid-cols-3" />
    </PageSkeleton>
  );
}
