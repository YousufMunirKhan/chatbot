'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * See `inbox/error.tsx` for why every list under `/company` carries one.
 *
 * Reports is the page most likely to reach this: a hand-typed `?from=`/`?to=`
 * or a range spanning a table an optional migration has not created can throw
 * where the resting page does not, so the second button drops the reader back
 * onto the default window rather than only offering the retry that will fail
 * the same way.
 */
export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-7xl">
      <Card>
        <CardContent className="p-0">
          <EmptyState
            title="We could not build this report"
            body="Your data is fine — this is the report failing to gather it. If you asked for a custom range, a shorter one often works."
            action={
              <>
                <Button size="sm" onClick={() => reset()}>
                  Try again
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/reports?tab=overview&range=last_7">
                    Show the last 7 days instead
                  </Link>
                </Button>
              </>
            }
          />
          {error.digest ? (
            <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
              If it keeps happening, quote this to support: <code>{error.digest}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
