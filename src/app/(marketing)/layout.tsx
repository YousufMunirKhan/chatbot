import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Chrome for the pages a stranger can reach without an account.
 *
 * There is no session here and there must not be one. `src/middleware.ts`
 * protects `/dashboard`, `/super-admin` and `/company`; everything in this route
 * group is deliberately outside those prefixes, so nothing below may import
 * `requireUser`, `requireRole`, or anything that reaches for a company id.
 *
 * It is a plain header and footer rather than a copy of the dashboard shell
 * because the dashboard shell is built around a signed-in company — its sidebar,
 * its impersonation banner and its plan badges all need a session this visitor
 * has not got.
 */

/**
 * Footer links.
 *
 * "How setup works" is in here as well as in the header because the header hides
 * it below `sm` — so on a phone, which is most of this traffic, the page
 * explaining the product had no route to it from anywhere except the pricing
 * page's own buttons.
 */
const footerLinks = [
  ['How setup works', '/customer-onboarding'],
  ['Pricing', '/pricing'],
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ['How we use AI', '/ai-disclosure'],
  ['Data processing', '/data-processing'],
] as const;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* The header is sticky and the first two tab stops are a logo and a nav,
          so without this a keyboard user tabs through the whole chrome on every
          public page before reaching the content. Visible only when focused. */}
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link href="/pricing" className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="inline-flex rounded-lg bg-brand-plate p-2">
              <Image
                src="/brand/switch-save-logo.png"
                alt="Switch &amp; Save"
                width={260}
                height={52}
                priority
                className="h-7 w-auto"
              />
            </span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/customer-onboarding"
              className="hidden rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-block"
            >
              How setup works
            </Link>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Start free</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t bg-muted/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm sm:px-8 md:flex-row md:items-center md:justify-between">
          <p className="text-muted-foreground">
            Switch &amp; Save — AI customer chat for UK small businesses.
          </p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {footerLinks.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
