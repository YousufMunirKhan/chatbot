import { HeaderSkeleton, ListCardSkeleton, PageSkeleton, PanelSkeleton } from '../../_skeletons';

/**
 * The contact page runs eight queries in two waves, so the wait is real and a
 * dead click on a customer's name would be the first thing an agent noticed
 * about the feature. The shape mirrors the page: heading, identity panel, then
 * the timeline.
 */
export default function ContactLoading() {
  return (
    <PageSkeleton className="max-w-5xl">
      <HeaderSkeleton />
      <PanelSkeleton lines={4} />
      <ListCardSkeleton rows={6} />
    </PageSkeleton>
  );
}
