import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Renders the back-link above the title. */
  backTo?: { href: string; label: string };
  /** Buttons or links aligned to the far end of the title row. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Dashboard page heading (Module 22).
 *
 * 52 of the 56 dashboard pages hand-write this same block, and the 13 back-links
 * among them use three different conventions — some a bare `Back to X` with no
 * glyph, some `← X` inside a muted link, one a literal arrow in the copy.
 *
 * The arrow here is RTL-safe: `globals.css` defines `.dir-arrow`, which mirrors
 * the glyph under `[dir='rtl']`, and it is `aria-hidden` so a screen reader
 * reads "Assistants", not "left arrow Assistants". That is the convention the
 * five newest back-links already follow; this makes it the only one.
 *
 * The title is an `<h1>` — one per page, which is what the 52 hand-written
 * blocks already do, so the outline stays correct.
 */
export function PageHeader({ title, description, backTo, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {backTo ? (
        <Link
          href={backTo.href}
          className="inline-block rounded-sm text-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="dir-arrow" aria-hidden="true">
            ←
          </span>{' '}
          {backTo.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* `min-w-0` AND `flex-1`: without the second, a short title leaves the
            actions sitting in the middle of the row on a wide screen. `break-words`
            because titles here are often user data — a company name, an agent's
            email, a webhook URL — and one long unbroken string in an `<h1>` is
            enough to give the whole page a horizontal scrollbar. */}
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="break-words text-2xl font-semibold">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {/*
          NOT `shrink-0` (Module 24). `Button` is `whitespace-nowrap`, so a row
          of them has a max-content width it cannot go below; pinning the
          container to that width meant three actions with real labels overflowed
          the page at 375px — the row wrapped onto its own line and then ran off
          the edge of it, because a wrapped flex item is sized by its content,
          not by the line it landed on.

          Allowing it to shrink lets the inner `flex-wrap` do its job and stack
          the buttons. `basis-full sm:basis-auto` is what makes the wrapped case
          deliberate rather than incidental: below 640px the actions take their
          own full-width line under the title instead of fighting it for room.
        */}
        {actions ? (
          <div className="flex min-w-0 basis-full flex-wrap gap-2 sm:basis-auto sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
