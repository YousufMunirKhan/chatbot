'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { useDirectionAnchor, type Direction } from './use-direction';

/**
 * Modal dialog (Module 23).
 *
 * This is the one place in the design system where a dependency was worth it.
 * Before this file the repo contained no focus trap, no Escape handler and no
 * `role="dialog"` anywhere — the three things a modal is, as opposed to a div
 * that happens to sit on top. Getting them right means inert-ing the page
 * behind, restoring focus to whatever opened the dialog, cycling Tab inside it,
 * suppressing background scroll without the layout shifting as the scrollbar
 * goes, and handling the pointer-vs-focus dismissal cases separately. That is
 * `@radix-ui/react-dialog`'s entire job.
 *
 * Everything else in `src/components/ui/` is hand-rolled on native elements so
 * that server components stay server-rendered. `Select` in particular is a
 * native `<select>` on purpose — it submits inside `<form action={serverAction}>`
 * for free. Do not "upgrade" it, and do not add a fourth overlay package:
 * `AlertDialog` and `Sheet` are both built on this one.
 *
 * ```tsx
 * <Dialog>
 *   <DialogTrigger asChild><Button>Edit</Button></DialogTrigger>
 *   <DialogContent>
 *     <DialogHeader>
 *       <DialogTitle>Edit contact</DialogTitle>
 *       <DialogDescription>Changes apply immediately.</DialogDescription>
 *     </DialogHeader>
 *     …
 *     <DialogFooter>
 *       <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
 *       <Button type="submit">Save</Button>
 *     </DialogFooter>
 *   </DialogContent>
 * </Dialog>
 * ```
 *
 * `DialogTitle` is not optional. Radix warns in development when it is missing
 * because without it the dialog opens with no accessible name and a screen
 * reader announces "dialog" and nothing else. Use `srOnlyTitle` if the design
 * has no visible heading.
 */

type OverlayDirectionValue = {
  ref: (node: HTMLElement | null) => void;
  dir: Direction;
};

const OverlayDirectionContext = React.createContext<OverlayDirectionValue>({
  ref: () => {},
  dir: 'ltr',
});

/** Shared by `Sheet` and `AlertDialog`, which are the same portal problem. */
export function useOverlayDirection(): OverlayDirectionValue {
  return React.useContext(OverlayDirectionContext);
}

export function OverlayDirectionProvider({
  dir,
  children,
}: {
  dir?: Direction;
  children: React.ReactNode;
}) {
  const anchor = useDirectionAnchor(dir);
  return (
    <OverlayDirectionContext.Provider value={anchor}>{children}</OverlayDirectionContext.Provider>
  );
}

/** Merges the direction-probe ref into whatever ref the caller passed. */
export function useAnchoredRef<T extends HTMLElement>(
  forwarded: React.ForwardedRef<T>,
): (node: T | null) => void {
  const { ref: anchorRef } = useOverlayDirection();
  return React.useCallback(
    (node: T | null) => {
      anchorRef(node);
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [anchorRef, forwarded],
  );
}

const Dialog = ({
  dir,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { dir?: Direction }) => (
  <OverlayDirectionProvider dir={dir}>
    <DialogPrimitive.Root {...props} />
  </OverlayDirectionProvider>
);
Dialog.displayName = 'Dialog';

const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => <DialogPrimitive.Trigger ref={useAnchoredRef(ref)} {...props} />);
DialogTrigger.displayName = DialogPrimitive.Trigger.displayName;

const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

/** The scrim. `bg-overlay` carries its own opacity token — see globals.css. */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('ui-overlay fixed inset-0 z-50 bg-overlay', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** The × in the corner. Shared with `Sheet`. */
export function OverlayCloseButton({ label = 'Close' }: { label?: string }) {
  return (
    <DialogPrimitive.Close
      className={cn(
        // Module 21 (RTL): `end-4`, not `right-4` — the close affordance belongs
        // at the trailing edge in both directions.
        'absolute end-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md',
        'text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
      <span className="sr-only">{label}</span>
    </DialogPrimitive.Close>
  );
}

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Set false when the footer already carries an explicit cancel control. */
  showClose?: boolean;
  closeLabel?: string;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, showClose = true, closeLabel, ...props }, ref) => {
  const { dir } = useOverlayDirection();
  return (
    <DialogPortal>
      <DialogOverlay />
      {/*
        Centring is done by this flex positioner rather than by a
        `-translate-1/2` on the panel itself, because the open/close animation
        animates `transform` — a translate used for layout and a translate used
        for motion cannot share the property. The positioner also gives long
        dialogs somewhere to scroll on a short viewport instead of overflowing
        off the top of the screen where nothing can reach them.

        It is not `pointer-events-none`: Radix decides "outside" from the event
        target, so a click on the positioner already counts as outside, and
        leaving pointer events on keeps the wheel working over the padding.
      */}
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
        <DialogPrimitive.Content
          ref={ref}
          dir={dir}
          data-side="center"
          className={cn(
            'ui-panel relative my-auto w-full max-w-lg rounded-lg border bg-card p-6 text-card-foreground shadow-lg',
            'focus-visible:outline-none',
            className,
          )}
          {...props}
        >
          {children}
          {showClose ? <OverlayCloseButton label={closeLabel} /> : null}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // `text-start`, not `text-left` (Module 21).
  <div className={cn('flex flex-col space-y-1.5 pe-8 text-start', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

/**
 * Action row. `justify-end` is flex logical, so it follows the reading
 * direction; on mobile the buttons stack in `column-reverse` so the primary
 * action stays closest to the thumb.
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & { srOnly?: boolean }
>(({ className, srOnly, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(srOnly ? 'sr-only' : 'text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
