'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export type NavSection = { group: string; items: { href: string; label: string }[] };

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
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-blue-100/70">
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
                    isActive(pathname, item.href)
                      ? 'bg-white/15 font-medium text-white shadow-sm'
                      : 'text-blue-50/90 hover:bg-white/10 hover:text-white',
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

/** Desktop sidebar (hidden on mobile) with active-route highlighting. */
export function DesktopSidebar({ sections, brand }: { sections: NavSection[]; brand: string }) {
  const pathname = usePathname();
  const brandHref = pathname.startsWith('/super-admin') ? '/super-admin' : '/company';
  return (
    <aside className="hidden w-64 shrink-0 bg-brand-sidebar p-4 text-white shadow-xl md:block">
      <Link href={brandHref} prefetch={false} className="mb-6 block rounded-2xl bg-white p-3 shadow-lg">
        <Image src="/brand/switch-save-logo.png" alt={brand} width={205} height={41} priority className="h-auto w-full" />
      </Link>
      <NavList sections={sections} pathname={pathname} />
    </aside>
  );
}

/** Mobile hamburger + slide-over drawer (hidden on desktop). */
export function MobileNav({ sections, brand }: { sections: NavSection[]; brand: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const brandHref = pathname.startsWith('/super-admin') ? '/super-admin' : '/company';
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[82%] flex-col overflow-y-auto bg-brand-sidebar p-4 text-white shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <Link href={brandHref} prefetch={false} onClick={() => setOpen(false)} className="rounded-2xl bg-white p-3">
                <Image src="/brand/switch-save-logo.png" alt={brand} width={205} height={41} priority className="h-auto w-48" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
