'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A short explanation attached to a label.
 *
 * Deliberately NOT a hover-only tooltip. Hover does not exist on a phone, and a
 * tooltip that only opens on hover hides its content from touch users and from
 * anyone navigating by keyboard. This opens on click or Enter, closes on Escape
 * or an outside click, and is announced because the trigger owns the panel.
 *
 * Use it for a term whose meaning is not obvious — "answered on its own",
 * "first response" — never for information the user needs in order to make the
 * decision in front of them. That belongs in `FormField`'s visible `hint`,
 * where nobody has to discover it.
 */
export function InfoHint({
  label,
  children,
  className,
}: {
  /** What this explains, e.g. "Answered on its own". Read by screen readers. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        // 24px is the smallest target WCAG 2.5.8 accepts; the icon inside is
        // smaller so it still reads as a quiet marker rather than a button.
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`What "${label}" means`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 7.1v3.4M8 5.1v.9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <span
          id={panelId}
          role="note"
          // `start-0` not `left-0`: this has to open inward in Arabic too.
          // `normal-case` and `tracking-normal` because this often sits inside a
          // table header, whose uppercase + letter-spacing would otherwise
          // cascade in and shout a whole sentence at the reader.
          className="absolute start-0 top-7 z-30 w-64 rounded-md border bg-popover p-3 text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
