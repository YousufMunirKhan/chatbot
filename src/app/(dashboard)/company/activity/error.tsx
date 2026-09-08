'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/** See `inbox/error.tsx` for why every list under `/company` carries one. */
export default function ActivityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardContent className="p-0">
          <EmptyState
            title="We could not load the activity log"
            body="Nothing has been erased — the log is still recording, this page just failed to read it. Trying again usually fixes it."
            action={
              <>
                <Button size="sm" onClick={() => reset()}>
                  Try again
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/activity">Start from the newest</Link>
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
