'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refreshes the tree when the user navigates with the browser Back or Forward
 * button.
 *
 * Next restores those navigations straight from the client Router Cache without
 * consulting staleTimes at all (restore-reducer), so Back always shows whatever
 * was rendered last time — however old. There is no config for this; a popstate
 * listener is the only lever.
 *
 * Mounted once in the dashboard layout: layouts are not re-executed on
 * client-side navigation, so this listener stays attached for the whole session
 * and covers every dashboard route. router.refresh() does not push history, so
 * this cannot loop.
 */
export function RefreshOnHistoryNav() {
  const router = useRouter();

  useEffect(() => {
    function onPopState() {
      router.refresh();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  return null;
}
