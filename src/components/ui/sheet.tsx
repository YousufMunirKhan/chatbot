'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import {
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogTitle,
  OverlayCloseButton,
  OverlayDirectionProvider,
  useAnchoredRef,
  useOverlayDirection,
} from './dialog';
import type { Direction } from './use-direction';

/**
 * Edge-anchored drawer (Module 23).
 *
 * A `Dialog` that arrives from an edge instead of the middle. Same package,
 * same focus trap, same Escape handler, same scrim — the mobile navigation
 * drawer in `src/components/dashboard-nav.tsx` used to carry a hand-written
 * copy of all three, and now carries none.
 *
 * **Sides are logical, not physical.** `start` and `end` follow the reading
 * direction: the drawer opened by the hamburger has to arrive from the same
 * edge the hamburger sits on, and that edge moves when an Arabic company
 * flips the shell to RTL. The slide animation flips with it — see the
 * `.ui-panel[data-side]` rules in globals.css, which read a direction that
 * `useDirectionAnchor` measures at the trigger and restates on the portalled
 * panel.
 */

/**
 * `overflow-hidden` on the PANEL, and the scrolling moved to an inner wrapper
 * (Module 24).
 *
 * The panel used to be the scroll container itself, with the × positioned
 * `absolute end-4 top-4` inside it. An absolutely positioned child of a scroll
 * container is placed in that container's unscrolled coordinates, so it scrolls
 * away with the content: open the mobile navigation on a phone, scroll to the
 * bottom of a long menu, and the close control is somewhere above the top of the
 * drawer. Escape and the scrim still worked, which is exactly why it was easy to
 * miss — the visible way out was the broken one.
 *
 * `min-h-0` on the wrapper is what makes this work in a flex column: a flex item
 * will not shrink below its content's height without it, so the wrapper would
 * grow past the panel and the panel — now `overflow-hidden` — would clip the
 * bottom of the menu instead of scrolling it.
 */
const sheetVariants = cva(
  'ui-panel fixed z-50 flex flex-col overflow-hidden bg-card text-card-foreground shadow-lg focus-visible:outline-none',
  {
    variants: {
      side: {
        // `w-[85%]` rather than `w-3/4` for the edge drawers: at 320px, three
        // quarters is 240px, and a navigation label plus its focus ring inside
        // 240px minus padding is where the group headings started wrapping.
        start: 'inset-y-0 start-0 h-full w-[85%] max-w-sm border-e',
        end: 'inset-y-0 end-0 h-full w-[85%] max-w-sm border-s',
        top: 'inset-x-0 top-0 max-h-[85dvh] w-full border-b',
        bottom: 'inset-x-0 bottom-0 max-h-[85dvh] w-full border-t',
      },
    },
    defaultVariants: { side: 'end' },
  },
);

const Sheet = ({
  dir,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { dir?: Direction }) => (
  <OverlayDirectionProvider dir={dir}>
    <DialogPrimitive.Root {...props} />
  </OverlayDirectionProvider>
);
Sheet.displayName = 'Sheet';

/**
 * Sets `aria-haspopup="dialog"` and `aria-expanded` on whatever it wraps, and
 * is where the drawer's direction is measured from. Use `asChild` to keep your
 * own button element.
 */
const SheetTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => <DialogPrimitive.Trigger ref={useAnchoredRef(ref)} {...props} />);
SheetTrigger.displayName = 'SheetTrigger';

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Set false when the drawer supplies its own close control. */
  showClose?: boolean;
  closeLabel?: string;
  /**
   * Classes for the inner scrolling wrapper rather than the panel.
   *
   * Use it for how the content is arranged — `gap-*`, `divide-y`, an extra
   * `items-*`. Width, background, border and PADDING belong on `className`,
   * i.e. on the panel: the panel no longer scrolls, so padding put there is a
   * fixed frame the content scrolls inside, and the drawer's edges keep their
   * breathing room at every scroll position.
   */
  bodyClassName?: string;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    { className, bodyClassName, children, side = 'end', showClose = true, closeLabel, ...props },
    ref,
  ) => {
    const { dir } = useOverlayDirection();
    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          dir={dir}
          data-side={side}
          className={cn(sheetVariants({ side }), className)}
          {...props}
        >
          {/* The scroll container. The × below is a sibling of it, not a child,
              which is the whole fix: it stays pinned to the panel. */}
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', bodyClassName)}>
            {children}
          </div>
          {showClose ? <OverlayCloseButton label={closeLabel} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 p-6 pe-14 text-start', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('min-h-0 flex-1 px-6 pb-6', className)} {...props} />
);
SheetBody.displayName = 'SheetBody';

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 border-t p-6 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);
SheetFooter.displayName = 'SheetFooter';

/** Aliases so a drawer reads as a drawer at the call site. Same components. */
const SheetTitle = DialogTitle;
const SheetDescription = DialogDescription;
const SheetClose = DialogClose;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
