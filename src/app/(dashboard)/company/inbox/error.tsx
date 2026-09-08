'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The inbox failed to load.
 *
 * There was no `error.tsx` anywhere in this app, so a query that threw — a
 * dropped Supabase connection, a column an optional migration has not added
 * yet — put the framework's own error screen in front of a shop owner, or in
 * production a blank page. Every list under `/company` now has one of these.
 *
 * Three things it has to do, in this order: say plainly that nothing was lost,
 * offer the retry (`reset` re-runs the server component, and a transient
 * failure clears on the first press), and carry the digest so support can find
 * the trace. The digest is the only machine string on the page and it is
 * labelled as one — an unlabelled hex string reads as a fault the reader
 * caused.
 */
export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <EmptyState
          title="We could not open your inbox"
          body="No chat was changed and nothing has been missed — this is the list failing to load, not the conversations. Trying again usually fixes it."
          action={
            <>
              <Button size="sm" onClick={() => reset()}>
                Try again
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/company">Back to home</Link>
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
  );
}
