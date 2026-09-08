'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';
import {
  DialogOverlay,
  OverlayDirectionProvider,
  useAnchoredRef,
  useOverlayDirection,
} from './dialog';
import type { Direction } from './use-direction';

/**
 * Confirmation dialog (Module 23).
 *
 * Built on `@radix-ui/react-dialog`, deliberately **not** on
 * `@radix-ui/react-alert-dialog`. Only three packages were added to this repo
 * and an alert dialog is a dialog with four differences, all of them
 * implementable here:
 *
 *   1. `role="alertdialog"`, so assistive tech announces the description
 *      immediately rather than waiting to be asked;
 *   2. no dismissal on outside interaction — an alert dialog is a question, and
 *      a stray click on the page behind is not an answer to it;
 *   3. opening focus lands on **Cancel**, not on the destructive action, so a
 *      reflexive Enter or Space does the harmless thing;
 *   4. a description is required, not optional — the whole point is to state
 *      the consequence before it happens.
 *
 * Escape still closes, which is what the WAI-ARIA practices ask for and is
 * safe: Escape is a cancel.
 *
 * **This is not a replacement for `ConfirmSubmit`.** That component keeps no
 * submit button in the DOM at all until the user arms it, so a stray click or
 * Enter cannot delete anything. A modal with a focused confirm button is
 * strictly less safe than a control that does not exist yet. Reach for
 * `AlertDialog` when you need to explain a consequence that does not fit
 * inline, not to dress up a delete button.
 */

const CancelRefContext = React.createContext<React.MutableRefObject<HTMLElement | null> | null>(
  null,
);

const AlertDialog = ({
  dir,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { dir?: Direction }) => {
  const cancelRef = React.useRef<HTMLElement | null>(null);
  return (
    <OverlayDirectionProvider dir={dir}>
      <CancelRefContext.Provider value={cancelRef}>
        <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
      </CancelRefContext.Provider>
    </OverlayDirectionProvider>
  );
};
AlertDialog.displayName = 'AlertDialog';

const AlertDialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => <DialogPrimitive.Trigger ref={useAnchoredRef(ref)} {...props} />);
AlertDialogTrigger.displayName = 'AlertDialogTrigger';

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { dir } = useOverlayDirection();
  const cancelRef = React.useContext(CancelRefContext);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
        <DialogPrimitive.Content
          ref={ref}
          role="alertdialog"
          dir={dir}
          data-side="center"
          onOpenAutoFocus={(event) => {
            if (!cancelRef?.current) return;
            event.preventDefault();
            cancelRef.current.focus();
          }}
          // Covers the pointer-outside and focus-outside cases in one hook.
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'ui-panel relative my-auto w-full max-w-md rounded-lg border bg-card p-6 text-card-foreground shadow-lg',
            'focus-visible:outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
});
AlertDialogContent.displayName = 'AlertDialogContent';

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-start', className)} {...props} />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    // `leading-tight`, not `leading-none` (Module 24) — an alert dialog is
    // `max-w-md` and its title states a consequence, so it wraps.
    className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = 'AlertDialogTitle';

/** Required. `role="alertdialog"` announces this on open; omit it and it announces nothing. */
const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName = 'AlertDialogDescription';

/** Registers itself as the element that receives focus when the dialog opens. */
const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ className, children = 'Cancel', ...props }, forwarded) => {
  const cancelRef = React.useContext(CancelRefContext);
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      if (cancelRef) cancelRef.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [cancelRef, forwarded],
  );
  return (
    <DialogPrimitive.Close
      ref={setRef}
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Close>
  );
});
AlertDialogCancel.displayName = 'AlertDialogCancel';

/**
 * The consequential button. Does **not** close the dialog on its own — the
 * caller decides, because a server action can fail and a dialog that has
 * already vanished has nowhere to put the error.
 */
const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'destructive';
  }
>(({ className, variant = 'destructive', type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant }), className)} {...props} />
));
AlertDialogAction.displayName = 'AlertDialogAction';

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
};
