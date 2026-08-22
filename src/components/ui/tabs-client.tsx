'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
import { useDirectionAnchor } from './use-direction';
import { TAB_BADGE, TAB_ITEM, TAB_LIST, TAB_SCROLLER } from './tab-styles';

/**
 * Client tabs (Module 23) — the mode where switching panels must not touch the
 * URL and must not re-fetch.
 *
 * `@radix-ui/react-tabs` is here for the roving tabindex: one stop in the tab
 * order for the whole rail, Arrow keys moving between tabs, Home/End jumping to
 * the ends, and `aria-controls` / `aria-labelledby` wired both ways. That is the
 * part of the ARIA Tabs pattern that is tedious to hand-roll and invisible when
 * it is missing.
 *
 * **Most screens in this app want `TabLinks` instead** — `?tab=` is a live URL
 * contract in roughly 25 places, and a tab you cannot link to or reload is a
 * regression. Use this mode only when the tabs are a local view toggle with no
 * URL meaning.
 *
 * Arrow keys reverse under RTL; `useDirectionAnchor` measures the direction in
 * force at the root and hands it to Radix, because the shell sets `dir` on a
 * wrapper element rather than on `<html>`.
 */
const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, dir, ...props }, forwarded) => {
  const anchor = useDirectionAnchor(dir);
  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      anchor.ref(node);
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [anchor, forwarded],
  );
  return (
    <TabsPrimitive.Root
      ref={setRef}
      dir={anchor.dir}
      className={cn('space-y-4', className)}
      {...props}
    />
  );
});
Tabs.displayName = 'Tabs';

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  // The scroller is a wrapper rather than the list itself: `overflow-x` on the
  // element that owns the focus ring clips the ring.
  <div className={TAB_SCROLLER}>
    <TabsPrimitive.List ref={ref} className={cn(TAB_LIST, className)} {...props} />
  </div>
));
TabsList.displayName = 'TabsList';

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    /** Count shown after the label. Rendered inside the tab's accessible name. */
    badge?: React.ReactNode;
  }
>(({ className, children, badge, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      TAB_ITEM,
      'border-transparent text-muted-foreground hover:text-foreground',
      'data-[state=active]:border-primary data-[state=active]:text-foreground',
      'disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    {badge !== undefined && badge !== null ? <span className={TAB_BADGE}>{badge}</span> : null}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('focus-visible:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
