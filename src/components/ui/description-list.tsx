import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DescriptionItem {
  /** Stable identity. Falls back to the term when it is a plain string. */
  key?: string;
  term: React.ReactNode;
  description: React.ReactNode;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  /**
   * - `inline` — a run of metadata under a heading: "Created 3 May · Owner Sam
   *   · 14 chats". Wraps, no rules, no box.
   * - `rows` — a record's details, one per line, with a rule between them.
   */
  variant?: 'inline' | 'rows';
  className?: string;
}

/**
 * Term-and-value pairs (Module 24).
 *
 * Eight places write a `<dl>` by hand, and the same two shapes keep reappearing
 * with different measurements: `flex flex-wrap gap-x-6 gap-y-1 text-sm
 * text-muted-foreground` on the insights and suggestions pages, `flex flex-wrap
 * gap-4 text-sm` on the agency page, `flex flex-wrap gap-x-4 gap-y-0.5 text-xs`
 * in the audit list — four spacings for one idea — and then `divide-y rounded-md
 * border` on the customer record against `grid grid-cols-2 gap-2` in the flow
 * builder.
 *
 * ## Why `<dl>` and not a two-column grid of `<div>`s
 *
 * The markup is the meaning. A `<dl>` tells a screen reader that "Owner" names
 * the thing after it, so the pair is announced together and can be navigated as
 * a unit; two divs in a grid are two unrelated strings that happen to be near
 * each other, and the reading order of a CSS grid is the DOM order regardless of
 * where the boxes land.
 *
 * ## The `rows` variant asks the CONTAINER, not the viewport
 *
 * The obvious way to write it is `grid-cols-1 sm:grid-cols-[12rem_1fr]`, and it
 * is wrong for the same reason `lg:grid-cols-4` was wrong in the form that
 * clipped a `<select>` mid-word: `sm:` reports the width of the WINDOW. This
 * component's real home is a card, and a card is 360px wide in a sidebar on a
 * 1440px screen — where every viewport breakpoint says "plenty of room" and
 * there is none.
 *
 * So the row is a `flex-wrap` with a basis on each half instead. Flexbox wraps
 * when the two bases no longer fit **the parent**, which is the actual question,
 * and it needs no plugin, no media query and no JavaScript. Wide container: term
 * and value side by side, the value taking three quarters of the free space.
 * Narrow container: the value drops to its own line, full width. There is no
 * width at which the term is squeezed to 60px and breaks one word per line.
 */
export function DescriptionList({ items, variant = 'inline', className }: DescriptionListProps) {
  if (items.length === 0) return null;

  if (variant === 'inline') {
    return (
      <dl className={cn('flex flex-wrap gap-x-6 gap-y-1 text-sm', className)}>
        {items.map((item, index) => (
          // The `<div>` wrapper is valid inside a `<dl>` (HTML 5.2 onwards) and
          // is what keeps a term glued to its value when the row wraps. Without
          // it, "Owner" ends one line and "Sam" starts the next.
          <div key={item.key ?? String(item.term) + index} className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-muted-foreground">{item.term}</dt>
            <dd className="min-w-0 break-words font-medium">{item.description}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className={cn('divide-y rounded-md border text-sm', className)}>
      {items.map((item, index) => (
        <div
          key={item.key ?? String(item.term) + index}
          className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3"
        >
          {/*
            `basis-*` is what makes this wrap on the CONTAINER: the two halves sit
            on one line while `8rem + 14rem` fits the parent and drop to two lines
            when it does not. `grow-[3]` on the value gives it three quarters of
            whatever room is left over on the wide path.

            `min-w-0` on both: a flex item will not shrink below its longest
            unbroken word without it, so one API key or customer email in a value
            widens the row, then the card, then the page.
          */}
          <dt className="min-w-0 grow basis-32 break-words text-muted-foreground">{item.term}</dt>
          <dd className="min-w-0 grow-[3] basis-56 break-words">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
