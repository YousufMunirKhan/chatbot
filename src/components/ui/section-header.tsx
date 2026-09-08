import * as React from 'react';
import { cn } from '@/lib/utils';

export type SectionHeaderSize = 'default' | 'lg' | 'eyebrow';
type HeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface SectionHeaderProps {
  title: React.ReactNode;
  /** One line saying what this block is for. Optional, and usually worth it. */
  description?: React.ReactNode;
  /** Buttons or links aligned to the far end of the title row. */
  actions?: React.ReactNode;
  /**
   * Where this sits in the document outline. `PageHeader` owns the page's one
   * `<h1>`, so a section inside a page is `2` and a block inside a card whose
   * `CardTitle` is already an `<h2>` is `3`. Levels are not decoration: a screen
   * reader user navigates a long settings page by them, and skipping one reads
   * as a missing section.
   */
  level?: HeadingLevel;
  /**
   * - `lg` — a major division of a long page (`text-lg`).
   * - `default` — a block inside a card (`text-base`). **Reach for this one.**
   *   It is what 19 places across the dashboard already use for a heading inside
   *   a card, against six in `bot-form.tsx` that invented a second style.
   * - `eyebrow` — small, uppercase, muted. That second style, kept because five
   *   of those six are a *group label above a run of fields* rather than a
   *   section heading, and demoting a run marker to the same weight as a section
   *   heading loses the distinction. Do not introduce new ones: if you are
   *   naming a block, `default` is the answer.
   */
  size?: SectionHeaderSize;
  /**
   * Set when a `<section>` or `<fieldset>` points at this with
   * `aria-labelledby`, which is how you give a region an accessible name
   * without a second, invisible copy of the words.
   */
  id?: string;
  className?: string;
}

/**
 * Heading for a block that is not the page (Module 24).
 *
 * 38 places write this by hand, in four different treatments for the same job:
 * `text-lg font-semibold` (9), `text-base font-semibold` (11), `text-sm
 * font-semibold` (7) and `text-sm font-semibold uppercase tracking-wider
 * text-muted-foreground` (5, all in `bot-form.tsx`). Several are `<h2>` inside a
 * card whose `CardTitle` is already an `<h2>`, which puts two peers in the
 * outline where there is visibly one section inside another; several more are a
 * bare `<p>` styled to look like a heading, which puts nothing in the outline at
 * all. And the description under them is sometimes `text-sm text-muted-foreground`
 * and sometimes `text-xs`.
 *
 * Three sizes, because there are three real jobs — a division of a page, a block
 * inside a card, a named group of fields — and the level is stated separately
 * from the size, because how big a heading looks and where it sits in the outline
 * are different questions. That separation is the point: `size="eyebrow"` is
 * small and quiet AND a real `<h3>`.
 *
 * Server component. Nothing here is interactive.
 */
const SIZES: Record<SectionHeaderSize, { title: string; description: string }> = {
  lg: { title: 'text-lg font-semibold', description: 'text-sm text-muted-foreground' },
  default: { title: 'text-base font-semibold', description: 'text-sm text-muted-foreground' },
  eyebrow: {
    title: 'text-sm font-semibold uppercase tracking-wider text-muted-foreground',
    description: 'text-xs text-muted-foreground',
  },
};

export function SectionHeader({
  title,
  description,
  actions,
  level = 2,
  size = 'default',
  id,
  className,
}: SectionHeaderProps) {
  const Heading = `h${level}` as const;
  const styles = SIZES[size];

  return (
    // The same shape as `PageHeader`, one step quieter, and for the same reason:
    // `Button` is `whitespace-nowrap`, so an actions block that is not allowed to
    // shrink overflows a narrow card instead of wrapping inside it. `basis-full`
    // below `sm` puts the actions on their own line rather than squeezing the
    // title into two words and a hyphen.
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <Heading id={id} className={cn('break-words leading-tight', styles.title)}>
          {title}
        </Heading>
        {description ? (
          <p className={cn('break-words', styles.description)}>{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 basis-full flex-wrap gap-2 sm:basis-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
