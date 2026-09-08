import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The container (Module 22).
 *
 * ## Two composition constraints, both of which have bitten
 *
 * **1. A card inside a card gives two borders and two radii.** `Card` bakes in
 * `rounded-lg border bg-card`. Nesting one gives you a rule 1px inside another
 * rule with an 8px corner inside an 8px corner, and on a `bg-card` page the
 * inner surface is invisible so all you see is the doubled edge. For a panel
 * INSIDE a card use a plain `rounded-md border bg-muted/30` block — the same
 * treatment `TAB_HELPER` uses — or a `border-t` divider and no box at all.
 *
 * **2. `min-w-0`.** A `Card` is `display: block`, but the moment it is a grid or
 * flex ITEM its minimum width becomes its content's, so one long unbroken string
 * — an API key, a webhook URL, a customer email — pushes the whole column wider
 * than its track and the PAGE scrolls sideways. That is why every two-column
 * layout in this repo carries `[&>*]:min-w-0` on the grid. If you write a grid
 * of cards, carry it too.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground', className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * Card title (Module 22).
 *
 * Renders a real heading so the 200-odd cards in the product contribute to the
 * document outline instead of being invisible to screen-reader heading
 * navigation. Tailwind's preflight resets `font-size`, `font-weight` and
 * `margin` on h1-h6, so swapping the old `<div>` for an `<h2>` is visually a
 * no-op — including the ~10 call sites that give it `flex items-center gap-2`
 * to sit an icon next to the text.
 *
 * Pass `level` when the surrounding outline needs something other than h2, e.g.
 * `<CardTitle level={3}>` for a card nested under a section heading.
 */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { level?: HeadingLevel }
>(({ className, level = 2, ...props }, ref) => {
  const Heading = `h${level}` as const;
  return (
    <Heading
      // `leading-tight`, not `leading-none` (Module 24). Card titles wrap all
      // the time — a 360px sidebar column, a three-up grid, any screen at 375px
      // — and a line box the exact height of the font puts the descenders of one
      // line into the ascenders of the next. This is the smallest leading that
      // clears them.
      ref={ref}
      className={cn('font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
});
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/**
 * ## `pt-0` assumes a `CardHeader` above it — and that is a trap
 *
 * The zero top padding exists so the header's `p-6` is not paid twice. It is
 * wrong for a card with no header: the content then starts hard against the top
 * border. 88 call sites use `<Card><CardContent>`, and 85 of them pass their own
 * `p-*` or `py-*`, which is the workaround wearing a hat.
 *
 * It is left as it is because changing the default silently re-spaces 88 screens
 * mid-flight. The rule for a NEW card:
 *
 *   - with a header → `<CardContent>`, unchanged;
 *   - without one → `<CardContent className="pt-6">`, or `className="p-4"` for
 *     a compact tile (which is what `StatTile` does).
 */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
