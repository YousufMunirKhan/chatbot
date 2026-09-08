import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DEFAULT_BRANDING, type AgencyBranding } from '@/lib/agency';

/**
 * The one layout every screen under `(auth)` uses.
 *
 * WHY THIS EXISTS
 * ---------------
 * The six auth screens were written at three different times and agreed on
 * nothing. Measured before this file:
 *
 *  - four card widths — `max-w-sm` (2FA challenge, emailed-code), `max-w-md`
 *    (sign in, sign up, forgot, reset), `max-w-xl` (2FA set-up);
 *  - two card treatments — `rounded-3xl … shadow-2xl shadow-blue-950/20`
 *    against `rounded-lg border shadow-sm`;
 *  - two page grounds — the brand gradient against `bg-muted/30`;
 *  - two heading sizes — `text-2xl font-extrabold` against `text-xl
 *    font-semibold`;
 *  - two control sizes — `h-12 rounded-xl` on sign in and sign up, the
 *    primitive's own `h-10 rounded-md` on the other four;
 *  - and the buttons landed in a different place on nearly every one.
 *
 * Signing in and signing up read as two products. They are now one component
 * with one set of slots, so a new auth screen cannot drift again — and every
 * colour is a token, which the old cards were not (`bg-white`,
 * `text-slate-500`, `shadow-blue-600/20`, `bg-emerald-50` are all invisible or
 * wrong in dark mode).
 *
 * THE SHAPE
 * ---------
 * Two columns from `lg` up: the brand rail, and the form. Below `lg` the form
 * comes first and the rail follows as a short summary — a phone must not have
 * to scroll past a marketing panel to reach the password box, which is exactly
 * what the old sign-in page did before it was capped.
 *
 * Server component on purpose: nothing here needs state, so an auth page ships
 * only the JavaScript its own form needs.
 */

export interface AuthShellProps {
  /** The page's `<h1>`. */
  title: React.ReactNode;
  /** One sentence under the title saying what happens next. */
  description?: React.ReactNode;
  /** The form. */
  children: React.ReactNode;
  /**
   * Links under the form — "Forgot password?", "Back to sign in". Rendered
   * above the divider that separates them from the account-switch line.
   */
  footer?: React.ReactNode;
  /** The one line offering the other side of the account question. */
  altAction?: { question: string; label: string; href: string };
  /**
   * `default` is a form of short fields. `wide` is for a screen carrying a
   * whole card of its own — two-step set-up, with its QR code and codes list.
   */
  width?: 'default' | 'wide';
  /**
   * `card` draws the bordered plate around the heading and the form, which is
   * what five of the six screens want. `plain` drops it for the one screen
   * whose content is already a `Card` — nesting one inside the other gives a
   * bordered box inside a bordered box, and two competing titles.
   */
  surface?: 'card' | 'plain';
  /** White-label branding for the agency serving this host (migration 0057). */
  branding?: AgencyBranding;
}

/** The rail's three claims. Copy lives here so all six screens make it. */
const RAIL_POINTS = [
  'AI support with human handoff',
  'Leads, bookings and customer chat in one inbox',
  'Your business knowledge, policies and quick answers',
];

function BrandMark({ branding, className }: { branding: AgencyBranding; className?: string }) {
  return (
    <span className={cn('inline-flex w-fit rounded-lg bg-brand-plate p-3', className)}>
      {branding.logoUrl ? (
        // An agency's logo is on a host we do not control, so `next/image`
        // would need it in `remotePatterns` to render at all.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt={branding.productName}
          className="h-9 w-auto max-w-[13rem] object-contain"
        />
      ) : (
        <Image
          src="/brand/switch-save-logo.png"
          alt={branding.productName}
          width={260}
          height={52}
          priority
          className="h-9 w-auto"
        />
      )}
    </span>
  );
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  altAction,
  width = 'default',
  surface = 'card',
  branding = DEFAULT_BRANDING,
}: AuthShellProps) {
  return (
    <div className="grid min-h-dvh bg-background text-foreground lg:grid-cols-2">
      {/* ---------------------------------------------------------------- */}
      {/* The form. First in the DOM, so a phone and a screen reader both    */}
      {/* reach it without wading through the rail.                         */}
      {/* It is the `<main>` landmark: the root layout renders no `<main>`,  */}
      {/* and the six auth pages each used to declare their own around the   */}
      {/* whole screen — which put the marketing rail inside it. The rail is */}
      {/* an `<aside>` beside it now, so "skip to main content" lands on the */}
      {/* password box rather than on a stack of claims about uptime.        */}
      <main className="order-1 flex flex-col justify-center px-5 py-10 sm:px-8 lg:order-2 lg:px-10">
        <div
          className={cn(
            'mx-auto w-full space-y-6',
            width === 'wide' ? 'max-w-xl' : 'max-w-md',
          )}
        >
          {/* Identity above the card on small screens, where the rail has been
              demoted to a footnote. Hidden at lg — the rail carries it there,
              and two logos on one screen is a mistake, not a system. */}
          <BrandMark branding={branding} className="border lg:hidden" />

          <div
            className={cn(
              surface === 'card'
                ? 'rounded-lg border bg-card p-6 text-card-foreground sm:p-8'
                : undefined,
            )}
          >
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description ? (
                <p className="text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>

            <div className="mt-6">{children}</div>

            {footer ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                {footer}
              </div>
            ) : null}

            {altAction ? (
              <p className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
                {altAction.question}{' '}
                <Link
                  href={altAction.href}
                  className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {altAction.label}
                </Link>
              </p>
            ) : null}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {branding.productName} &copy; {new Date().getFullYear()}
          </p>
        </div>
      </main>

      {/* ---------------------------------------------------------------- */}
      {/* The rail. A fixed dark surface in both themes — the same gradient  */}
      {/* the dashboard sidebar wears — so its text uses the sidebar         */}
      {/* foreground tokens rather than a raw white that only works in one   */}
      {/* theme.                                                            */}
      <aside
        className="relative order-2 overflow-hidden bg-brand-sidebar bg-cover bg-center px-5 py-10 text-sidebar-fg sm:px-8 lg:order-1 lg:flex lg:flex-col lg:px-12 lg:py-14"
        style={
          branding.loginBackground
            ? { backgroundImage: `url(${branding.loginBackground})` }
            : undefined
        }
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]"
        />

        <div className="relative flex w-full flex-1 flex-col lg:mx-auto lg:max-w-lg">
          <BrandMark branding={branding} className="hidden lg:inline-flex" />

          {/* `text-2xl` on a phone and `text-4xl` only once the rail is a
              column of its own. The old page jumped to `text-5xl` at `sm`,
              which is still a 640px-wide phone in landscape. */}
          <p className="text-2xl font-semibold leading-tight tracking-tight lg:mt-10 lg:text-4xl">
            Run service, sales and customer chat from one place.
          </p>
          <p className="mt-3 max-w-xl text-sm text-sidebar-fg-muted lg:mt-5 lg:text-base">
            Manage your {branding.productName} AI assistant, live chats, enquiries, bookings and
            business knowledge from one dashboard.
          </p>

          <ul className="mt-6 space-y-3 text-sm text-sidebar-fg-muted lg:mt-8">
            {RAIL_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-sidebar-fg"
                >
                  ✓
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          {/* The stat strip is the first thing to go when the rail is a
              stacked footnote: on a phone it was three cards of decoration
              between the customer and the rest of the page. */}
          <div className="mt-auto hidden gap-3 pt-10 lg:grid lg:grid-cols-3">
            {[
              ['99.9%', 'uptime focus'],
              ['24/7', 'AI availability'],
              ['Human', 'takeover ready'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-white/15 bg-white/10 p-4">
                <div className="text-xl font-semibold">{value}</div>
                <div className="mt-0.5 text-xs text-sidebar-fg-subtle">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * A link in the `footer` slot. Exists so the six screens cannot each invent
 * their own underline, weight and focus ring for the same thing.
 */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}
