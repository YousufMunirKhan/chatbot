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
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      {children}
    </ThemeProvider>
  );
}
