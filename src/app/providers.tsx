'use client';

import { ThemeProvider } from 'next-themes';

/**
 * Client providers, wrapped once at the root layout.
 *
 * TanStack Query was removed: the dashboard renders every screen server-side and
 * the repo contained no useQuery/useMutation call anywhere, so the provider only
 * shipped an unused client to every page.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      /*
        Module 23. Roughly 40 elements in the shell and the design system carry
        `transition-colors`. Without this, toggling the theme animates every one
        of them independently for 150ms and the whole page smears through an
        intermediate palette. next-themes handles it by injecting a
        `* { transition: none }` rule for one frame around the class swap, which
        is the only way to suppress a transition that is defined per-element.

        It does not affect hover or focus transitions — the rule is removed on
        the next frame.
      */
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
