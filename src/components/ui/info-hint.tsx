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
 *
 * ## The constraint: it is not portalled, so a scroll container clips it
 *
 * The panel is an absolutely positioned sibling of the trigger, so any ancestor
 * with a non-`visible` overflow cuts it off — and `Table` wraps every table in
 * exactly such a container, because that is what stops wide tables scrolling the
 * page. Setting `overflow-x` alone does not help: CSS computes the other axis
 * from `visible` to `auto` whenever its partner is not `visible`, so an
 * `overflow-x-auto` box clips vertically too.
 *
 * So: put an `InfoHint` in a card, a stat label, a section header or a
 * `FormField` label — anywhere in normal page flow. Do NOT put one inside a
 * `<TableHead>`; the panel will be clipped by the table's scroller and the text
 * you wrote will be unreadable. Explaining a column belongs above the table.
 * (`company/reports/page.tsx` uses it correctly today, on card headings.)
 *
 * A portalled version would need `Popover`, which is already in the system and
 * already handles collisions — that is the upgrade path if a hint inside a
 * scroller is ever genuinely needed.
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

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
  // Which edge the panel hangs from. It opens from the leading edge, which is
  // right for a trigger in the first column and wrong for one in the last: a
  // 256px panel hung off a marker near the trailing edge of the page simply ran
  // off the screen, and the copy inside it was unreachable. There is no
  // positioning library here on purpose, so it is measured once on open.
  const [align, setAlign] = React.useState<'start' | 'end'>('start');
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const panelRef = React.useRef<HTMLSpanElement>(null);
  const panelId = React.useId();

  // Reset before every measurement so a panel that flipped once is re-tested
  // from the same starting point after a resize or a scroll.
  //
  // `useIsomorphicLayoutEffect`: this component is server-rendered even though
  // it is `'use client'`, and React logs a warning for every `useLayoutEffect`
  // it meets during SSR. The layout variant is still what we want in the
  // browser — it measures and flips before the paint, so the panel never
  // appears in the wrong place for a frame first.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setAlign('start');
      return;
    }
    const panel = panelRef.current;
    const trigger = wrapperRef.current;
    if (!panel || !trigger) return;
    const margin = 8;
    const width = panel.getBoundingClientRect().width;
    const triggerRect = trigger.getBoundingClientRect();
    const rtl = window.getComputedStyle(trigger).direction === 'rtl';
    // In LTR the panel grows to the right of the trigger's left edge; in RTL it
    // grows to the left of its right edge. Flip when that runs past the viewport.
    const overflows = rtl
      ? triggerRect.right - width < margin
      : triggerRect.left + width > window.innerWidth - margin;
    setAlign(overflows ? 'end' : 'start');
  }, [open]);

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
          ref={panelRef}
          id={panelId}
          role="note"
          // `bg-card text-card-foreground`, NOT `bg-popover
          // text-popover-foreground` (Module 24). `--popover` is part of the
          // stock shadcn token set and this product deliberately never defined
          // it: it is absent from `globals.css` AND from `tailwind.config.ts`,
          // so those two class names compiled to **nothing at all**. The panel
          // has been transparent since it was written — a bordered, shadowed
          // rectangle with the page showing through it and its own text
          // overlapping whatever sat behind. `bg-card` is what `Popover` and
          // `Dialog` use for exactly this surface, and it is defined in both
          // themes.
          //
          // `start-0`/`end-0` not `left-0`/`right-0`: this has to open inward in
          // Arabic too, and `align` above decides which edge it hangs from.
          // `normal-case` and `tracking-normal` because a trigger often sits in
          // an uppercase, letter-spaced label, which would otherwise cascade in
          // and shout a whole sentence at the reader.
          // `max-w-[calc(100vw-1rem)]` is the backstop for the case the flip
          // cannot solve: a viewport narrower than the panel itself.
          className={cn(
            'absolute top-7 z-30 w-64 max-w-[calc(100vw-1rem)] rounded-md border bg-card p-3',
            'text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-card-foreground shadow-lg',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
