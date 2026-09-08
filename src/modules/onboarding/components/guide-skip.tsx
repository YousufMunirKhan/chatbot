'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Remembering what somebody chose to skip.
 *
 * WHY THERE IS NO MIGRATION BEHIND THIS
 * -------------------------------------
 * Where a company "got to" in setup is not a stored cursor — it is derived.
 * `getCompanySetupProgress()` recomputes every step's completion from the real
 * data (bots, capabilities, business memory, documents, domain allowlist) on
 * every render, so closing the tab and coming back a week later already lands
 * on the right screen with no help from anybody. A `setup_progress` table would
 * be a second, staler answer to a question the product can already answer, and
 * the first time the two disagreed the table would win and be wrong.
 *
 * The one thing that genuinely is not derivable is intent: "I have seen this
 * step and I do not want it today". That is a per-person preference, worth
 * nothing to anybody else, and losing it costs a single extra click — so it
 * lives in `localStorage`, keyed by company id so one browser used for two
 * tenants cannot mix them up. `setup-data` exposes `companyId` for exactly this.
 *
 * Everything here degrades: each control is a real link with a real `href`, and
 * the skip is recorded on the way past. With JavaScript off, or storage blocked
 * by the browser, every button still goes where it says it goes.
 */

function storageKey(companyId: string): string {
  return `setup-guide:${companyId}:skipped`;
}

function readSkipped(companyId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Private windows, cleared site data, and browsers set to block storage all
    // land here. Nothing about this feature is important enough to break a page.
    return [];
  }
}

function writeSkipped(companyId: string, keys: string[]): void {
  try {
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(keys));
  } catch {
    /* see readSkipped */
  }
}

/**
 * "Skip for now". A plain link that records the skip as it is followed.
 */
export function SkipStepLink({
  companyId,
  stepKey,
  href,
  children = 'Skip for now',
}: {
  companyId: string;
  stepKey: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <Button asChild variant="ghost" size="lg">
      <Link
        href={href}
        onClick={() => {
          const current = readSkipped(companyId);
          if (!current.includes(stepKey)) writeSkipped(companyId, [...current, stepKey]);
        }}
      >
        {children}
      </Link>
    </Button>
  );
}

/**
 * "Pick up where you left off".
 *
 * Renders the server's answer — the first unfinished step — immediately, so the
 * button is correct and clickable before any JavaScript runs. On mount it
 * refines that to the first unfinished step the person has not already waved
 * away, which is what "where you left off" means to them rather than to us. If
 * they skipped everything that is left, it falls back to the server's answer
 * rather than pointing at nothing.
 */
export function ResumeGuideLink({
  companyId,
  /** Unfinished step keys, in order, from `getCompanySetupProgress()`. */
  remainingKeys,
  /** Where each key's screen lives. Built server-side so this cannot misspell one. */
  hrefByKey,
  fallbackHref,
  label,
  className,
}: {
  companyId: string;
  remainingKeys: string[];
  hrefByKey: Record<string, string>;
  fallbackHref: string;
  label: string;
  className?: string;
}) {
  const [href, setHref] = React.useState(fallbackHref);

  React.useEffect(() => {
    const skipped = readSkipped(companyId);
    const next = remainingKeys.find((key) => !skipped.includes(key));
    setHref(next ? (hrefByKey[next] ?? fallbackHref) : fallbackHref);
    // `remainingKeys` and `hrefByKey` are rebuilt on every server render, so
    // they are compared by content rather than identity.
  }, [companyId, fallbackHref, hrefByKey, remainingKeys]);

  return (
    <Button asChild size="lg" className={className}>
      <Link href={href}>{label}</Link>
    </Button>
  );
}

/**
 * Clears the skip memory. Shown on the finish screen and on the checklist once
 * something has been skipped, because a preference you cannot see or undo is
 * not a preference, it is a trap.
 */
export function ClearSkipsButton({ companyId }: { companyId: string }) {
  const [skipped, setSkipped] = React.useState<string[]>([]);

  React.useEffect(() => {
    setSkipped(readSkipped(companyId));
  }, [companyId]);

  if (skipped.length === 0) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        writeSkipped(companyId, []);
        setSkipped([]);
      }}
    >
      Show the {skipped.length} step{skipped.length === 1 ? '' : 's'} I skipped
    </Button>
  );
}
