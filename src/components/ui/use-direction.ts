'use client';

import * as React from 'react';

export type Direction = 'ltr' | 'rtl';

/**
 * Writing direction for portalled overlays (Module 23).
 *
 * The dashboard shell sets `dir="rtl"` on a wrapper element (not on `<html>`)
 * because only the shell knows the signed-in company's language — see
 * `src/app/(dashboard)/layout.tsx`. Radix portals dialog and popover content to
 * `<body>`, which is *outside* that wrapper, so a portalled panel inherits LTR
 * no matter what the page around the trigger is doing. Two things break as a
 * result: Tailwind's logical utilities (`start-0`, `ms-2`) resolve the wrong
 * way, and Radix's own `dir`-sensitive behaviour (tab arrow keys, popover
 * `align`) points the wrong way too.
 *
 * The fix is to measure the direction where the trigger actually lives and
 * restate it on the portalled panel. Attach `ref` to any element inside the
 * shell — the trigger is the natural one — and hand `dir` to the panel.
 *
 * `getComputedStyle` rather than `closest('[dir]')`: direction is inherited
 * through CSS, so an element can be RTL without any ancestor carrying the
 * attribute (the `[dir='rtl'] { direction: rtl }` rule in globals.css, a
 * `direction` declaration in a stylesheet, or `dir` on `<html>` itself).
 *
 * Returns `'ltr'` on the server and on the first client render, so it never
 * causes a hydration mismatch; RTL is applied in the effect that follows. The
 * measurement is only consumed by overlays, none of which can be open during
 * that first paint.
 */
export function useDirectionAnchor(override?: Direction): {
  ref: (node: HTMLElement | null) => void;
  dir: Direction;
} {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [detected, setDetected] = React.useState<Direction>('ltr');

  React.useEffect(() => {
    if (override || !node) return;
    const resolved = window.getComputedStyle(node).direction === 'rtl' ? 'rtl' : 'ltr';
    setDetected((previous) => (previous === resolved ? previous : resolved));
  }, [node, override]);

  return { ref: setNode, dir: override ?? detected };
}
