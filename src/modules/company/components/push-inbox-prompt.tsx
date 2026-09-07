'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePushSubscription } from './use-push-subscription';

/**
 * The second place phone alerts are offered — and the reason there is a second
 * place at all: almost nobody visits the notification settings screen, but
 * every agent lives in the inbox.
 *
 * Timing rules, all of them deliberate:
 *  - never on the first visit. Someone still finding their way around has no
 *    idea what they would be agreeing to, and a refused permission is
 *    permanent — the browser will not ask twice.
 *  - never on first paint of the qualifying visit either; the browser prompt
 *    only opens when the user clicks the button in this banner.
 *  - dismissed once, gone for good. A nag bar in a work queue is a tax.
 */

const VISITS_KEY = 'agent-inbox:visits';
const DISMISSED_KEY = 'agent-inbox:push-prompt-dismissed';
const MIN_VISITS = 2;

function readNumber(key: string): number {
  try {
    return Number(window.localStorage.getItem(key) ?? '0') || 0;
  } catch {
    // Private mode / storage disabled: treat as a first visit and stay quiet.
    return 0;
  }
}

export function PushInboxPrompt() {
  const push = usePushSubscription();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY) === '1') return;
      const visits = readNumber(VISITS_KEY) + 1;
      window.localStorage.setItem(VISITS_KEY, String(visits));
      setEligible(visits >= MIN_VISITS);
    } catch {
      setEligible(false);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* nothing to persist to; hiding for this session is enough */
    }
    setEligible(false);
  }

  // Only ever shown when there is genuinely something to switch on. Every other
  // state (unsupported, denied, no keys, already subscribed) is explained
  // properly on the alerts screen instead of half-explained in a banner.
  if (!eligible || push.state !== 'available') return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-info-border bg-info-bg px-4 py-3 text-sm text-info-fg">
      <p className="min-w-0">
        <span className="font-medium">Get alerted when a customer needs a person.</span> We can
        notify this device the moment a chat is handed over, even when this tab is closed.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={() => void push.enable()} disabled={push.busy}>
          {push.busy ? 'Turning on…' : 'Turn on alerts'}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
