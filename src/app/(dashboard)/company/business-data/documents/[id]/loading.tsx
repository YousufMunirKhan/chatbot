import { HeaderSkeleton, PageSkeleton, PanelSkeleton } from '../../../_skeletons';

/**
 * Its own placeholder, because the one on the Business Data segment above draws
 * five stat tiles and a tab strip — neither of which this page has. A skeleton
 * that promises a layout the page does not have is a flash of the wrong screen.
 */
export default function KnowledgeDocumentLoading() {
  return (
    <PageSkeleton className="max-w-4xl">
      <HeaderSkeleton />
      <PanelSkeleton lines={8} />
    </PageSkeleton>
  );
}
