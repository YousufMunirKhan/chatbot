'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export type NavSection = { group: string; items: { href: string; label: string }[] };

/**
 * Focus ring shared by every interactive element in the shell chrome.
 *
 * The sidebar sits on a dark brand background, so the default `ring-ring`
 * token (tuned for light surfaces) is close to invisible here. A white ring
 * with a brand-coloured offset is the only combination that stays visible
 * against both the resting and the active nav-item background.
 *
 * Module 23: `ring-white` → `ring-sidebar-fg` and the offset now resolves to
 * `--sidebar-base`, which is defined in both themes. It used to be the literal
 * `#13224b`, a full step lighter than the dark ramp it is meant to back.
 */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-fg focus-visible:ring-offset-2 focus-visible:ring-offset-brand-sidebar';

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Highlight a parent for nested routes, but not the section roots.
  if (href === '/company' || href === '/super-admin' || href === '/dashboard') return false;
  return pathname.startsWith(href + '/');
}

function NavList({ sections, pathname, onNavigate }: { sections: NavSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-6">
      {sections.map((section) => (
        <div key={section.group}>
          {/* Module 23: was `text-blue-100/70` — a raw palette value with no
              dark-mode definition. `--sidebar-fg-subtle` is contrast-checked
              against the gradient's mid stop in both themes. */}
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-sidebar-fg-subtle">
            {section.group}
          </p>
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  onClick={onNavigate}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-2 py-2 text-sm transition-colors md:py-1.5',
                    FOCUS_RING,
                    isActive(pathname, item.href)
                      ? 'bg-sidebar-active font-medium text-sidebar-fg shadow-sm'
                      : 'text-sidebar-fg-muted hover:bg-sidebar-hover hover:text-sidebar-fg',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Whose account am I looking at?
 *
 * The logo is identical on every tenant and previously carried the account name
 * only as `alt` text, which is invisible to a sighted operator. Rendering the
 * name as real text is the difference between "I am on the platform" and "I am
 * inside a paying customer's data".
 */
function WorkspaceIdentity({ brand, impersonating }: { brand: string; impersonating?: boolean }) {
  return (
    <div className="mt-3 px-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-fg-subtle">
        {impersonating ? 'Viewing customer account' : 'Account'}
      </p>
      <p
        className={cn(
          'mt-0.5 break-words text-sm font-semibold leading-snug',
          // Fuchsia here is the same signal as the banner at the top of the
          // page: this name is a customer's, not the platform's. Tokenised so
          // that stays true in dark mode (Module 23).
          impersonating ? 'text-impersonation-accent' : 'text-sidebar-fg',
        )}
      >
        {brand}
      </p>
    </div>
  );
}

/**
 * The white plate the logo sits on.
 *
 * `bg-brand-plate` is white in both themes on purpose — the artwork is dark
 * ink on transparency, so a themed plate would erase it in dark mode. It is a
 * token rather than a literal `bg-white` so that the shell has no unexplained
 * palette values left in it.
 */
function BrandMark({
  brand,
  href,
  onNavigate,
  className,
  imageClassName,
}: {
  brand: string;
  href: string;
  onNavigate?: () => void;
  className?: string;
  imageClassName?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onNavigate}
      className={cn('block rounded-2xl bg-brand-plate p-3', FOCUS_RING, className)}
    >
      <Image
        src="/brand/switch-save-logo.png"
        alt={brand}
        width={205}
        height={41}
        priority
        className={cn('h-auto', imageClassName ?? 'w-full')}
      />
    </Link>
  );
}

/** Desktop sidebar (hidden on mobile) with active-route highlighting. */
export function DesktopSidebar({
  sections,
  brand,
  impersonating,
}: {
  sections: NavSection[];
  brand: string;
  impersonating?: boolean;
}) {
  const pathname = usePathname();
  const brandHref = pathname.startsWith('/super-admin') ? '/super-admin' : '/company';
  return (
    <aside className="hidden w-64 shrink-0 bg-brand-sidebar p-4 text-sidebar-fg shadow-xl md:block">
      <div className="mb-6">
        <BrandMark brand={brand} href={brandHref} className="shadow-lg" />
        <WorkspaceIdentity brand={brand} impersonating={impersonating} />
      </div>
      <NavList sections={sections} pathname={pathname} />
    </aside>
  );
}

/**
 * Mobile hamburger + slide-over drawer (hidden on desktop).
 *
 * Module 23: this used to carry its own focus trap, its own Escape handler, its
 * own `role="dialog" aria-modal` and its own focus-restore effect — about 45
 * lines of the hardest-to-test code in the shell, and the only implementation
 * of any of it in the repo. All four now come from `Sheet`, which is the same
 * `@radix-ui/react-dialog` that `Dialog` and `AlertDialog` are built on, so
 * there is one implementation to get right instead of one per drawer. Radix
 * adds the things the hand-rolled version did not have: the page behind is made
 * inert rather than merely covered, background scroll is locked without the
 * layout shifting as the scrollbar goes, and focus is restored to the hamburger
 * even when the drawer closes because a link inside it navigated.
 *
 * `side="start"` is logical. The hamburger sits in a flex row that reverses
 * under RTL, so a physically-pinned drawer would fly out from the opposite edge
 * of the screen to the button that summoned it.
 */
export function MobileNav({
  sections,
  brand,
  impersonating,
}: {
  sections: NavSection[];
  brand: string;
  impersonating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const brandHref = pathname.startsWith('/super-admin') ? '/super-admin' : '/company';

  // The trigger is `md:hidden`, but the drawer is portalled to <body> and so is
  // not inside that wrapper. Without this, rotating a tablet or resizing across
  // the breakpoint with the drawer open leaves a modal scrim over a desktop
  // layout that has a permanent sidebar and no visible way to dismiss it.
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia('(min-width: 768px)');
    if (desktop.matches) {
      setOpen(false);
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="md:hidden">
        <SheetTrigger asChild>
          {/* Radix supplies `aria-haspopup="dialog"` and `aria-expanded`. */}
          <button
            type="button"
            aria-label="Open menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="start"
        // The drawer paints the sidebar gradient, not the card surface, so the
        // default panel background and the default × (tuned for a card) are
        // both replaced.
        showClose={false}
        className="w-72 max-w-[82%] border-e-0 bg-brand-sidebar p-4 text-sidebar-fg"
      >
        <SheetTitle srOnly>Navigation menu</SheetTitle>
        <SheetDescription className="sr-only">
          Move between the sections of the dashboard.
        </SheetDescription>

        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <BrandMark
              brand={brand}
              href={brandHref}
              onNavigate={() => setOpen(false)}
              imageClassName="w-48"
            />
            <WorkspaceIdentity brand={brand} impersonating={impersonating} />
          </div>
          <SheetClose
            aria-label="Close menu"
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sidebar-fg hover:bg-sidebar-hover',
              FOCUS_RING,
            )}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </SheetClose>
        </div>

        <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Live impersonation countdown.
 *
 * The previous banner rendered `toLocaleTimeString()` on the server, so it was
 * formatted in the server's timezone rather than the operator's and never moved.
 * The session expiring mid-task looked like a random logout. This renders the
 * remaining time on the client, ticking every second, and escalates its tone at
 * five minutes and one minute.
 */
function useTimeLeft(expiresAt: string): number | null {
  // `null` until mounted: the server has no clock the client agrees with, so
  // rendering a number during SSR would guarantee a hydration mismatch.
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    if (!Number.isFinite(target)) return;
    const tick = () => setMsLeft(Math.max(0, target - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return msLeft;
}

function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ImpersonationBanner({
  companyName,
  expiresAt,
  children,
}: {
  companyName: string;
  expiresAt: string;
  /** The existing `EndImpersonationButton` server-action form, passed through. */
  children: React.ReactNode;
}) {
  const msLeft = useTimeLeft(expiresAt);

  const expired = msLeft !== null && msLeft <= 0;
  const critical = msLeft !== null && msLeft > 0 && msLeft <= 60_000;
  const warning = msLeft !== null && msLeft > 60_000 && msLeft <= 5 * 60_000;
  const alarm = expired || critical;

  return (
    /*
      Fuchsia is used nowhere else in this application. Amber already means
      "warning", "coming soon", "needs data" and three other things, so an amber
      impersonation banner reads as one more inert notice. This bar is a colour
      that means exactly one thing.

      Module 23: the six hardcoded `fuchsia-*` classes are now the
      `--impersonation-*` tokens, defined in BOTH themes — the distinction was
      about to disappear the first time anyone switched to dark, because none of
      them had a `.dark` value. The escalation is inverted in the dark block on
      purpose: "critical" going darker is more severe against a white page and
      *less* visible against a near-black one, so dark mode escalates by getting
      brighter instead. See globals.css.

      `sticky top-0 z-50` is the load-bearing part: the exit control lives in
      here, so a banner that scrolls away is a banner that strands the operator
      inside a customer's account with no way out on the page.
    */
    <div
      className={cn(
        'sticky top-0 z-50 flex flex-col items-start justify-between gap-2 border-b px-4 py-2 text-sm text-impersonation-fg shadow-md sm:flex-row sm:items-center sm:gap-4 sm:px-6',
        alarm
          ? 'border-impersonation-critical bg-impersonation-critical'
          : 'border-impersonation-border bg-impersonation',
      )}
    >
      <p className="min-w-0">
        <span className="font-semibold">You are inside {companyName}.</span>{' '}
        <span className="text-impersonation-fg-muted">
          Everything you see and every change you make belongs to this customer.
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-3">
        {/* Announced politely rather than assertively: a per-second live region
            set to "assertive" would interrupt a screen-reader user continuously. */}
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold tabular-nums',
            alarm
              ? // Inverted at the sharp end: a white chip on the banner is the
                // loudest thing this bar can do without adding a new colour.
                'bg-impersonation-alarm-bg text-impersonation-alarm-fg'
              : warning
                ? 'bg-impersonation-critical/60 text-impersonation-fg'
                : 'bg-impersonation-critical/35 text-impersonation-fg-muted',
          )}
        >
          {msLeft === null
            ? 'Session ending soon'
            : expired
              ? 'Session expired'
              : `Ends in ${formatCountdown(msLeft)}`}
        </span>
        {children}
      </div>
    </div>
  );
}
