import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table (Module 22; scroll container corrected, Module 24).
 *
 * ## The wrapper is the reason the page does not scroll sideways
 *
 * A `<table>` will not shrink below the widest word in its widest cell, so a
 * table with six columns and a webhook URL in one of them is simply wider than a
 * phone. The wrapper is what absorbs that: the table scrolls inside its own box
 * and the page body stays put. **Never remove it, and never put a table in a
 * layout that cannot let it be narrow** (a grid track without `min-w-0` will
 * widen to the table's content instead, and then the whole page scrolls).
 *
 * `overflow-x-auto`, not `overflow-auto`: the vertical half of `auto` was doing
 * nothing — there is no height limit here — but it did make the wrapper a
 * scroll container on both axes, which clips anything a cell tries to render
 * outside its bounds. `InfoHint`'s panel in a `TableHead` is the live example.
 *
 * ## What is deliberately not here
 *
 * No `tabIndex={0}` on the wrapper. A keyboard-only user genuinely cannot scroll
 * a region that contains no focusable element (WCAG 2.1.1), and the usual fix is
 * to make the scroller itself focusable — but that adds a tab stop to all 35
 * tables in the product, including the ~30 that never overflow, and every one of
 * them would then announce as an unnamed group. The narrow fix belongs on the
 * few tables that are genuinely wide, with a real `aria-label`, not on all of
 * them by default. Listed in `docs/UI_SIMPLIFICATION.md` as known-open.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('border-b transition-colors hover:bg-muted/50', className)} {...props} />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // `text-start`, not `text-left` (Module 22): the dashboard shell sets
      // dir="rtl" for Arabic companies, so cells flip but a hardcoded
      // `text-left` header would not — every table in the product misaligned.
      'h-10 px-3 text-start align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-3 py-2.5 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
