import * as React from 'react';
import { cn } from '@/lib/utils';

export type FieldGridMin = 'sm' | 'md' | 'lg';

export interface FieldGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The narrowest a column is allowed to get before the grid drops one.
   *
   * - `sm` (11rem / 176px) — short values: a quantity, a status, a two-letter
   *   currency. Do not put a `<select>` with real sentences in it here.
   * - `md` (16rem / 256px) — the default. A labelled text input with a hint
   *   under it, or a select whose options are two or three words.
   * - `lg` (22rem / 352px) — a field whose label or hint is a full sentence, and
   *   anything containing a `<select>` with long option text.
   */
  min?: FieldGridMin;
  /** `4` is `gap-4`, the form rhythm. `6` for a grid of cards. */
  gap?: 4 | 6;
}

/**
 * A grid that asks how wide its CONTAINER is (Module 24).
 *
 * ## The bug this exists to make impossible
 *
 * A form was laid out with `lg:grid-cols-4` inside a column about 500px wide.
 * `lg:` is a media query — it reports the width of the WINDOW — so on a
 * full-width screen the rule fired, each of the four fields got about 110px, and
 * a `<select>` clipped its own text mid-word. Nothing about that column was
 * ever 1024px. Every viewport breakpoint in this codebase can make the same
 * mistake, and roughly a third of the dashboard is two-column, so roughly a
 * third of it is exposed to it.
 *
 * The honest fix is a container query, and this repo does not have the plugin.
 * It does not need one: `repeat(auto-fit, minmax(min(100%, Xrem), 1fr))` is the
 * same answer in plain CSS, supported everywhere, and it works on any container
 * including one whose width nothing knows in advance.
 *
 * Read it right to left:
 *
 *   - `1fr` — columns share the space equally;
 *   - `minmax(…, 1fr)` — but never narrower than the floor;
 *   - `min(100%, 16rem)` — and the floor is 16rem **or the container's full
 *     width, whichever is smaller**. This clause is what stops the grid
 *     overflowing a container narrower than one column: without it, a 16rem
 *     floor inside a 200px parent produces a 256px column and a page that
 *     scrolls sideways;
 *   - `auto-fit` — fit as many as that allows, then collapse the empty tracks so
 *     the last row's fields stretch instead of leaving a gap.
 *
 * The result: one column at 375px, two in a 500px sidebar, four across a wide
 * page — decided by the space the grid is actually in, with no breakpoint to
 * pick and nothing to get wrong.
 *
 * ```tsx
 * <FieldGrid>
 *   <FormField label="Name" htmlFor="name"><Input id="name" name="name" /></FormField>
 *   <FormField label="Status" htmlFor="status"><Select id="status" name="status">…</Select></FormField>
 * </FieldGrid>
 * ```
 *
 * ## When NOT to use it
 *
 * A field the user reads left to right as a sentence — a long textarea, a legal
 * consent, the one thing the page is about — belongs full width. `auto-fit` will
 * happily give it a half-width column beside something unrelated. Put those in
 * their own `space-y-4` block, or hand the child `className="col-span-full"`.
 *
 * Server component, and deliberately so: it is a `<div>` with a `style`, which
 * means it can be used by the ~40 forms in this product that are server-rendered
 * inside `<form action={serverAction}>` and ship no JavaScript at all.
 */
const MINS: Record<FieldGridMin, string> = {
  sm: '11rem',
  md: '16rem',
  lg: '22rem',
};

export function FieldGrid({ min = 'md', gap = 4, className, style, ...props }: FieldGridProps) {
  return (
    <div
      className={cn('grid', gap === 6 ? 'gap-6' : 'gap-4', className)}
      style={{
        // Written as an inline style rather than an arbitrary Tailwind class
        // because the value contains commas and parentheses that Tailwind's
        // arbitrary-value parser mangles, and because it is one declaration that
        // is easier to read here than as a 60-character class name.
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${MINS[min]}), 1fr))`,
        ...style,
      }}
      {...props}
    />
  );
}
