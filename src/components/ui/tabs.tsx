import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  TAB_BADGE,
  TAB_HELPER,
  TAB_ITEM,
  TAB_ITEM_IDLE,
  TAB_ITEM_SELECTED,
  TAB_LIST,
  TAB_SCROLLER,
} from './tab-styles';

/**
 * Tabs, both modes (Module 23).
 *
 * This file is **not** `'use client'`. `TabLinks` below is a server component
 * and stays one; the Radix client mode is re-exported from `./tabs-client`, so
 * the client boundary sits in that file and importing `TabLinks` does not drag
 * `@radix-ui/react-tabs` into a page that ships no JavaScript.
 *
 * ---
 *
 * **Link mode (`TabLinks`) is the default choice.** `?tab=` is a live URL
 * contract in roughly 25 places across this app: screens read the search param
 * on the server and render only the active panel's data. Tabs that live in the
 * URL are linkable, bookmarkable, survive a reload, work with Back, and — the
 * part that actually decides it — do not require the page to hydrate.
 *
 * These are anchors, so they are marked up as anchors: a `<nav>` with a list of
 * links and `aria-current="page"` on the active one. They are deliberately NOT
 * given `role="tab"`. The ARIA tabs pattern promises Arrow-key movement between
 * panels that are already on the client; a link that navigates cannot keep that
 * promise, and claiming the role tells a screen-reader user to expect behaviour
 * that will not happen.
 *
 * ```tsx
 * // in a server component
 * const active = searchParams.tab ?? 'products';
 * <TabLinks label="Business data sections" active={active} items={[
 *   { key: 'products', label: 'Products', badge: products.length,
 *     helper: 'What you sell. The assistant quotes from this list.' },
 *   { key: 'faqs', label: 'FAQs', badge: faqs.length },
 * ]}>
 *   {active === 'products' ? <ProductsPanel /> : <FaqsPanel />}
 * </TabLinks>
 * ```
 *
 * The `helper` and `badge` fields are carried over from
 * `src/modules/company/components/business-data-tabs.tsx`, which is the one
 * accessible tab implementation the app already had.
 */

export interface TabLinkItem {
  /** Value of `?tab=` for this tab, and its React key. */
  key: string;
  label: string;
  /** One line shown under the rail while this tab is active. */
  helper?: string;
  /** Count or short status shown after the label. */
  badge?: React.ReactNode;
  /** Defaults to `?tab=<key>`, which keeps every other search param intact
   *  only if you pass a full href — see the note in the README. */
  href?: string;
}

export interface TabLinksProps {
  items: TabLinkItem[];
  /** The `?tab=` value currently in force. Falls back to the first tab. */
  active?: string | null;
  /** Names the rail for screen readers, e.g. "Business data sections". */
  label: string;
  /** The active panel's content. Rendered by the caller — one panel, not all. */
  children?: React.ReactNode;
  className?: string;
}

export function TabLinks({ items, active, label, children, className }: TabLinksProps) {
  if (items.length === 0) return null;
  const activeItem = items.find((item) => item.key === active) ?? items[0]!;

  return (
    <div className={cn('space-y-4', className)}>
      <nav aria-label={label} className={TAB_SCROLLER}>
        <ul className={TAB_LIST}>
          {items.map((item) => {
            const selected = item.key === activeItem.key;
            return (
              <li key={item.key} className="flex">
                <Link
                  href={item.href ?? `?tab=${encodeURIComponent(item.key)}`}
                  prefetch={false}
                  // The active tab is the current page, so `aria-current="page"`
                  // is the honest attribute. `aria-selected` belongs to
                  // `role="tab"`, and these are links.
                  aria-current={selected ? 'page' : undefined}
                  className={cn(TAB_ITEM, selected ? TAB_ITEM_SELECTED : TAB_ITEM_IDLE)}
                >
                  {item.label}
                  {item.badge !== undefined && item.badge !== null ? (
                    <span className={TAB_BADGE}>{item.badge}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {activeItem.helper ? <p className={TAB_HELPER}>{activeItem.helper}</p> : null}

      {children}
    </div>
  );
}

/**
 * The helper strip on its own, for screens that lay the rail out themselves.
 */
export function TabHelper({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(TAB_HELPER, className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs-client';
