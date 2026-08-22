'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { useDirectionAnchor, type Direction } from './use-direction';

/**
 * Anchored overlay (Module 23).
 *
 * The third piece of real focus management this design system needed. A
 * popover is not a tooltip: it holds focusable content, so it owns a focus
 * trap while open, returns focus to its trigger on close, closes on Escape and
 * on interaction outside, and marks the trigger `aria-expanded`. It is also not
 * a dialog: it does not make the page inert, and it has to reposition itself
 * when the trigger is near an edge or inside a scroll container — which is the
 * collision logic in `@radix-ui/react-popover`.
 *
 * **This is not a menu and not a select.** A list of commands wants
 * `role="menu"` with Arrow-key movement; a form control wants the native
 * `<select>` that `select.tsx` already is, because it submits inside
 * `<form action={serverAction}>` with no JavaScript. Use `Popover` for a small
 * amount of *content* attached to a control: a filter panel, a colour picker, a
 * "what does this mean" panel too long to be a tooltip.
 *
 * ```tsx
 * <Popover>
 *   <PopoverTrigger asChild><Button variant="outline" size="sm">Filters</Button></PopoverTrigger>
 *   <PopoverContent>…</PopoverContent>
 * </Popover>
 * ```
 *
 * `align` is direction-sensitive: `align="start"` means the leading edge, which
 * is the right-hand edge under RTL. Radix can only know that if it is told, and
 * the shell sets `dir` on a wrapper element rather than on `<html>`, so
 * `useDirectionAnchor` measures it at the trigger and `PopoverContent` restates
 * it on the portalled panel.
 */

type PopoverDirectionValue = {
  ref: (node: HTMLElement | null) => void;
  dir: Direction;
};

const PopoverDirectionContext = React.createContext<PopoverDirectionValue>({
  ref: () => {},
  dir: 'ltr',
});

const Popover = ({
  dir,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root> & { dir?: Direction }) => {
  const anchor = useDirectionAnchor(dir);
  return (
    <PopoverDirectionContext.Provider value={anchor}>
      <PopoverPrimitive.Root {...props} />
    </PopoverDirectionContext.Provider>
  );
};
Popover.displayName = 'Popover';

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>((props, forwarded) => {
  const { ref: anchorRef } = React.useContext(PopoverDirectionContext);
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      anchorRef(node);
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [anchorRef, forwarded],
  );
  return <PopoverPrimitive.Trigger ref={setRef} {...props} />;
});
PopoverTrigger.displayName = 'PopoverTrigger';

const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, collisionPadding = 12, ...props }, ref) => {
  const { dir } = React.useContext(PopoverDirectionContext);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        dir={dir}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // `shadow-lg` is elevation level 2 in this system — reserved for
          // genuine overlays, which this is. See ui/README.md.
          'ui-popover z-50 w-72 rounded-lg border bg-card p-4 text-card-foreground shadow-lg',
          'focus-visible:outline-none',
          // Never taller than the space Radix measured for it; scroll instead
          // of spilling past the viewport edge.
          'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = 'PopoverContent';

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent, PopoverClose };
