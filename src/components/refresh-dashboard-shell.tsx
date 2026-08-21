'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the dashboard shell after a mutation that changes layout-level data
 * (company name, the "Internal Help Desk" nav item — see (dashboard)/layout.tsx).
 *
 * On a client-side navigation Next only re-executes segments that actually
 * changed, so a layout never re-renders on its own. revalidatePath() cannot
 * reach it either: a Server Action response is rendered against the client's
 * own router state, which carries no refetch marker. router.refresh() marks the
 * root as "refetch", which is the only in-app way to re-run a layout short of a
 * full page load.
 *
 * Render this inside any form whose action mutates shell data, passing the
 * useFormState result. useFormState hands back a fresh object per submission,
 * so every successful save triggers exactly one refresh.
 */
export function RefreshDashboardShell({ state }: { state: { ok?: boolean } }) {
  const router = useRouter();

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return null;
}

/**
 * One-shot variant for flows that redirect instead of returning to a form.
 * createBotAction redirects to the new assistant's settings page, and creating
 * a help-desk assistant adds the "Internal Help Desk" nav item — which the
 * layout would otherwise not pick up until a full page load.
 */
export function RefreshDashboardShellOnce() {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.refresh();
  }, [router]);

  return null;
}
