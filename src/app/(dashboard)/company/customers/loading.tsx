import { HeaderSkeleton, ListCardSkeleton, PageSkeleton } from '../_skeletons';

/**
 * One list, not three. The page stopped being three stacked previews when it
 * became a list of people, and a placeholder that still promised three tables
 * would make the real page look like it had lost something on arrival.
 */
export default function CustomersLoading() {
  return (
    <PageSkeleton>
      <HeaderSkeleton />
      <ListCardSkeleton rows={8} />
    </PageSkeleton>
  );
}
