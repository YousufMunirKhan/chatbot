/**
 * Shared appearance for both tab modes (Module 23).
 *
 * `Tabs` (Radix, client) and `TabLinks` (anchors, server) render different
 * markup for different reasons, but a user cannot be expected to notice which
 * one a screen happens to use. Keeping the classes in one string file — no
 * JSX, no `'use client'`, importable from either side of the boundary — is what
 * stops the two drifting apart.
 */

/** The scrolling rail. `border-b` under it is what the markers sit on. */
export const TAB_LIST =
  'flex min-w-max items-stretch gap-1 border-b';

/** Wrap `TAB_LIST` in this so a long rail scrolls instead of wrapping. */
export const TAB_SCROLLER = 'overflow-x-auto';

/**
 * A single tab. `text-start` and `ms-2` on the badge rather than `text-left` /
 * `ml-2`, so the label and its count follow the reading direction (Module 21).
 */
export const TAB_ITEM = [
  'border-b-2 px-3 py-3 text-start text-sm font-medium transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  // The ring is inset because the item's own bottom border is the selection
  // marker; an offset ring would sit on top of it and read as selected.
  'focus-visible:ring-inset',
].join(' ');

export const TAB_ITEM_SELECTED = 'border-primary text-foreground';
export const TAB_ITEM_IDLE = 'border-transparent text-muted-foreground hover:text-foreground';

/** Count badge next to a tab label. */
export const TAB_BADGE =
  'ms-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground';

/**
 * Per-tab explanatory strip. Carried over from `business-data-tabs.tsx`, which
 * is the one place in the app that already got tabs right: the helper answers
 * "what am I looking at" without spending a paragraph of the panel on it.
 */
export const TAB_HELPER =
  'rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground';
