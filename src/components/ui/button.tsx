import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Button (Module 22; size scale reconciled, Module 24).
 *
 * ## Heights line up with the text controls now
 *
 * `default` is 40px and `sm` is 36px — the same two heights `Input`, `Select`
 * and every other text control get from `control-styles.ts`. That is the whole
 * point of the scale: a filter bar is a search box, a dropdown and a button in
 * one row, and if the three heights come from three places the row can never sit
 * flat. `lg` (44px) is the page-level call to action and is deliberately not in
 * that table — nothing lines up against it.
 *
 * The square sizes now match the same rhythm: `icon` is 40px, `icon-sm` 36px,
 * `icon-xs` 32px. They exist because six call sites were writing
 * `size="sm" className="h-7 w-7 p-0"` or hand-rolling
 * `inline-flex h-9 w-9 items-center justify-center rounded-md` from scratch —
 * `flow-builder.tsx`, `flow-inspector.tsx`, `dashboard-nav.tsx` and the dialog
 * close control among them — because the only square size was 40px.
 *
 * ## `whitespace-nowrap` is load-bearing, and it is also the trap
 *
 * A button that wraps to two lines reads as broken, so it does not wrap. The
 * consequence is that a long label in a narrow column OVERFLOWS instead — it
 * cannot shrink and it cannot break. Two rules follow:
 *
 *   1. keep labels short — "Save", "Add product", not a sentence;
 *   2. the CONTAINER wraps, not the button. Put buttons in a `flex flex-wrap`
 *      that is allowed to shrink (`min-w-0`, no `shrink-0`) — see `PageHeader`,
 *      which had exactly this bug at 375px.
 *
 * ## An icon-only button needs a name
 *
 * `size="icon"` renders no text, so it has no accessible name unless you give it
 * one. Always pass `aria-label`. There is no lint rule that will catch this.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        /** 40px — matches `Input` / `Select` at their default size. */
        default: 'h-10 px-4 py-2',
        /** 36px — matches `Input size="sm"` / `Select size="sm"`. Toolbars. */
        sm: 'h-9 px-3',
        /** 44px — page-level call to action. Nothing lines up against it. */
        lg: 'h-11 px-8',
        /** 40px square. Pass `aria-label`. */
        icon: 'h-10 w-10',
        /** 36px square, for a toolbar row running at `sm`. Pass `aria-label`. */
        'icon-sm': 'h-9 w-9',
        /**
         * 32px square, for a control inside a dense row (a table cell, a flow
         * step's move/delete pair). Still clears the 24px WCAG 2.5.8 minimum
         * target with room to spare. Pass `aria-label`.
         */
        'icon-xs': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
