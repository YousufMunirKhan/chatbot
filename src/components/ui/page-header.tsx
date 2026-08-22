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
        <Link href={backTo.href} className="text-sm text-muted-foreground hover:underline">
          <span className="dir-arrow" aria-hidden="true">
            ←
          </span>{' '}
          {backTo.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
