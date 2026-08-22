import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading UI (/super-admin/costs).
 *
 * There were no `loading.tsx` files anywhere in this app, so every navigation
 * into a super-admin screen sat on the previous page with no feedback while the
 * server component awaited its queries — and these are the slow ones
 * (`getCompanyDetail` alone fans out to 17 parallel reads).
 *
 * The skeletons mirror the real layout's boxes so the page does not jump when
 * the data lands. `Skeleton` is `aria-hidden`, so the region carries
 * `aria-busy` — that is what tells assistive tech to wait rather than announcing
 * a screenful of grey rectangles.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Card>
        <CardContent className="space-y-3 p-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
