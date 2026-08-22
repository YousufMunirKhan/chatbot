import { HeaderSkeleton, ListCardSkeleton, PageSkeleton, StatGridSkeleton } from '../_skeletons';

export default function CustomersLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton withAction />
      <StatGridSkeleton count={3} className="sm:grid-cols-3 lg:grid-cols-3" />
      <ListCardSkeleton rows={5} />
      <ListCardSkeleton rows={4} />
      <ListCardSkeleton rows={4} />
    </PageSkeleton>
  );
}
