import * as React from 'react';
import { cn } from '@/lib/utils';

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
    <Heading ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
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

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
