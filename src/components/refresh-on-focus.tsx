'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pulls fresh server data when the tab regains focus.
 *
 * Leads, orders, appointments and notifications are written by API routes — the
 * website widget, channel webhooks, connectors — rather than by Server Actions,
 * so nothing tells an already-open dashboard tab that its data moved. Supabase
 * realtime is not an option for these either: only conversations and messages
 * are in the supabase_realtime publication (see 0005_conversations.sql), which
 * is why the inbox can use InboxRealtime and these screens cannot.
 *
 * Refreshing on focus covers the case that actually bites: leaving the tab open,
 * doing something else, coming back to stale numbers. router.refresh() re-runs
 * the whole tree, so it is throttled.
 */
const MIN_INTERVAL_MS = 10_000;

export function RefreshOnFocus() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefresh.current < MIN_INTERVAL_MS) return;
      lastRefresh.current = now;
      router.refresh();
    }

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return null;
}
