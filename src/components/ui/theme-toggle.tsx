'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

/**
 * Light / Dark / System switch (Module 23).
 *
 * Until this component existed, dark mode in this product had never once
 * activated. `tailwind.config.ts` sets `darkMode: ['class']`, `globals.css`
 * carries a complete `.dark` token block, and `providers.tsx` mounts
 * `next-themes` with `enableSystem` — but nothing anywhere called `setTheme`,
 * so the class was never applied on purpose. With `enableSystem` on, the only
 * thing standing between a user whose OS is dark and a half-painted dashboard
 * was the absence of this control.
 *
 * ### Why three options and not a two-state switch
 *
 * `enableSystem` means "system" is already the behaviour a first-time visitor
 * gets. A two-state sun/moon switch hides that: the user sees a moon, taps it,
 * and has silently opted *out* of following their OS forever, with no way back
 * short of clearing site data. Showing System as a peer of Light and Dark makes
 * the default visible and makes returning to it a single click.
 *
 * ### Why radios rather than buttons
 *
 * This is a single choice from three, which is what a radio group is. Using
 * real `<input type="radio">` elements means the platform supplies the parts
 * that are easy to get wrong: one tab stop for the whole group rather than
 * three, Arrow keys moving between options, `aria-checked` state maintained by
 * the browser, and the announcement "Dark, radio button, 2 of 3". The inputs
 * are `sr-only` — visually hidden, never `display: none` — so they keep focus
 * and hit-testing, and the visible focus ring is carried by the sibling label
 * through `peer-focus-visible`.
 *
 * ### Hydration
 *
 * `useTheme()` returns `undefined` on the server and on the first client
 * render, so every option renders unchecked in both and the markup matches;
 * the real state lands in the effect that follows. The theme *class* itself is
 * applied before first paint by the blocking script `ThemeProvider` injects, so
 * the page never flashes the wrong theme — that part depends on
 * `suppressHydrationWarning` staying on `<html>` in `src/app/layout.tsx`.
 */

type ThemeOption = 'light' | 'dark' | 'system';

const OPTIONS: { value: ThemeOption; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
];

export interface ThemeToggleProps {
  className?: string;
  /**
   * Whether the words "Light / Dark / System" show beside the icons.
   *
   * `auto` (the default, and what this always did) reveals them at the `lg`
   * viewport breakpoint. That is only correct where this actually sits today —
   * the dashboard header, which is as wide as the window. **`lg:` measures the
   * VIEWPORT, not the parent**, so dropping the toggle into a settings card in a
   * 360px column on a 1440px screen makes it declare it has room for three
   * labelled options and overflow the card. Pass `never` there, or `always` in a
   * preferences panel where the icons alone are too terse.
   *
   * The labels are never removed from the accessible name — `never` renders them
   * `sr-only`, exactly as `auto` does below `lg`.
   */
  labels?: 'auto' | 'always' | 'never';
}

const LABEL_VISIBILITY: Record<NonNullable<ThemeToggleProps['labels']>, string> = {
  auto: 'sr-only lg:not-sr-only',
  always: '',
  never: 'sr-only',
};

export function ThemeToggle({ className, labels = 'auto' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  // The live region stays empty until the user actually changes something.
  // Populating it on mount would make every page load announce the theme.
  const [announcement, setAnnouncement] = React.useState('');

  React.useEffect(() => setMounted(true), []);

  const current: ThemeOption | undefined = mounted ? ((theme ?? 'system') as ThemeOption) : undefined;

  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">Colour theme</legend>
      <div
        className={cn(
          'inline-flex items-center gap-0.5 rounded-md border bg-muted/60 p-0.5',
          // `dir`-agnostic: a flex row reverses on its own under RTL, and the
          // options have no inherent order beyond "least to most dark".
        )}
      >
        {OPTIONS.map((option) => {
          const id = `theme-option-${option.value}`;
          return (
            <div key={option.value} className="relative flex">
              <input
                type="radio"
                id={id}
                name="theme"
                value={option.value}
                checked={current === option.value}
                onChange={() => {
                  setTheme(option.value);
                  setAnnouncement(
                    option.value === 'system'
                      ? 'Theme set to follow your system setting.'
                      : `Theme set to ${option.label.toLowerCase()}.`,
                  );
                }}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'inline-flex h-8 cursor-pointer select-none items-center justify-center gap-1.5 rounded-[calc(var(--radius)-4px)] px-2 text-xs font-medium',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'peer-checked:bg-background peer-checked:text-foreground peer-checked:shadow-sm',
                  // The ring lives on the label because the input it belongs to
                  // is visually hidden.
                  'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                )}
              >
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  {option.icon}
                </svg>
                <span className={LABEL_VISIBILITY[labels]}>{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>

      {/*
        "System" is the one option whose label does not tell you what you are
        looking at. Saying which way it resolved closes that gap for a
        screen-reader user, who has no other way to find out.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
        {announcement && current === 'system' && resolvedTheme
          ? ` Currently ${resolvedTheme}.`
          : ''}
      </p>
    </fieldset>
  );
}
