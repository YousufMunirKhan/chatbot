import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/**
 * One header and one list — the shape the page settles into. The filter bar is
 * inside the card's header, so `ListCardSkeleton` already stands in for it.
 */
export default function CompanyActivityLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton />
      <ListCardSkeleton rows={8} />
    </PageSkeleton>
  );
}
