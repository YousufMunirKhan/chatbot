import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/**
 * Two lists, because the page is always two: what was ordered in chat, and what
 * came across from a connected shop. Standing in for only one of them would
 * make the arriving page look like it had grown a section on load.
 */
export default function OrdersLoading() {
  return (
    <PageSkeleton className="max-w-7xl">
      <HeaderSkeleton />
      <ListCardSkeleton rows={5} />
      <ListCardSkeleton rows={4} />
    </PageSkeleton>
  );
}
