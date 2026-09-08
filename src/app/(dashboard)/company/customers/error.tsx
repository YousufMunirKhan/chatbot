'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Covers the customer list and every contact page under it.
 * See `inbox/error.tsx` for why every list under `/company` carries one.
 */
export default function CustomersError({
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
            title="We could not load your customers"
            body="No customer record has been changed — this is the page failing to load. Trying again usually fixes it."
            action={
              <>
                <Button size="sm" onClick={() => reset()}>
                  Try again
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/company/customers">Back to the customer list</Link>
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
