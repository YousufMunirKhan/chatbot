import { requireUser, type SessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { SignOutButton } from '@/components/sign-out-button';
import { DesktopSidebar, ImpersonationBanner, MobileNav } from '@/components/dashboard-nav';
import { EndImpersonationButton } from '@/modules/super-admin/components/end-impersonation-button';
import { RefreshOnHistoryNav } from '@/components/refresh-on-history-nav';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getAgencyForOwner, resolveBranding, DEFAULT_BRANDING, type AgencyBranding } from '@/lib/agency';
import { getDictionary, navKey, t, tOr, type Dictionary } from '@/lib/i18n';
import { getCompanyLocaleInfo } from '@/lib/i18n/server';
import {
  AGENT_NAV_GROUPS,
  COMPANY_NAV_FALLBACK,
  PLATFORM_NAV_GROUPS,
  companyNavGroups,
  type NavGroupDef,
} from '@/components/dashboard-nav-items';

/**
 * Protected dashboard shell (Module 1 shell + Module 3 auth). Requires a signed-in
 * user and renders role-based navigation (Access Rules: super admin → platform,
 * company admin → full company, agent → conversation-focused subset).
 */
/**
 * The nav itself lives in `src/components/dashboard-nav-items.ts`.
 *
 * It used to be three arrays declared here, which made this file — already the
 * one every dashboard change touches — the place where "add a page" collided
 * with everything else. It is pure data, so it moved out; this file is left with
 * the part that genuinely needs the session: which set to show, and translating
 * it.
 *
 * `NavGroupDef` is `NavSection` plus a `key`, which is what the group heading is
 * translated by ('Talk to customers' is not a dictionary key; `conversations` is).
 */
type NavSection = NavGroupDef;

/**
 * Direction AND language for the dashboard shell (Module 21).
 *
 * The root `src/app/layout.tsx` cannot do this: it renders for the marketing,
 * auth and widget-embed routes too and has no session, so it has no company to
 * read `default_language` from. This layout already loads the company, so both
 * attributes are set on the shell wrapper element instead — `dir` and `lang` on
 * a container are valid HTML and inherit to every descendant exactly like they
 * do on <html>.
 *
 * `lang` used to be deliberately left alone, because the copy was still English
 * and telling a screen reader otherwise would have it pronounce English words
 * with an Arabic voice. That reason is gone: `src/lib/i18n` now translates the
 * shell and the pages it wraps, so the language attribute is finally true.
 *
 * 'auto' and anything unrecognised stay English/LTR, so the un-configured case
 * renders exactly as before.
 */
type ShellDir = 'ltr' | 'rtl';

interface CompanyShell {
  /** Several grouped sections now, not one flat list. */
  nav: NavSection[];
  brand: string;
  dir: ShellDir;
  locale: string;
  dict: Dictionary;
  branding: AgencyBranding;
}

async function companyShellFor(user: SessionUser): Promise<CompanyShell> {
  // One cached read for name + language (see src/lib/i18n/server.ts) — it
  // replaces the `companies` query this function used to make itself, so
  // translation costs the shell no extra round trip.
  const localeInfo = await getCompanyLocaleInfo();
  const base = {
    dir: localeInfo.dir,
    locale: localeInfo.locale,
    dict: localeInfo.dict,
  };
  if (!user.companyId)
    return {
      ...base,
      nav: COMPANY_NAV_FALLBACK,
      brand: 'Company',
      branding: DEFAULT_BRANDING,
    };

  const sb = createSupabaseServiceClient();
  const [{ data: internalBot }, { data: connector }, branding, ownedAgency] = await Promise.all([
    sb
      .from('bots')
      .select('id')
      .eq('company_id', user.companyId)
      .or('bot_type.eq.help_desk,appearance_json->>assistantAudience.eq.internal')
      .limit(1)
      .maybeSingle(),
    sb
      .from('helpdesk_connectors')
      .select('id')
      .eq('company_id', user.companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    // Both memoised in-process for a minute (src/lib/agency.ts), so the common
    // "no agency" answer costs nothing after the first render.
    resolveBranding(user.companyId),
    getAgencyForOwner(user.userId),
  ]);

  // Both conditional rows are placed inside the group they belong to rather than
  // spliced by index the way the flat list did it — the staff help desk sits with
  // the customer inbox, the agency console with the account settings.
  const nav = companyNavGroups({
    showInternalHelpDesk: Boolean(internalBot || connector),
    // The agency console exists only for the operator who owns one (0057).
    showAgency: Boolean(ownedAgency),
  });

  return {
    ...base,
    nav,
    // An agency's product name replaces the platform's, but never the tenant's
    // own name: "whose account am I in" is what the sidebar answers.
    brand: localeInfo.companyName ?? 'Company',
    branding,
  };
}

/**
 * Swap each nav label for its translation, keyed off the href (`nav.company.inbox`),
 * and each group heading for `nav.group.<key>`. Anything with no dictionary entry
 * keeps the English it was declared with, so adding a route can never blank a row.
 */
function translateSections(sections: NavSection[], dict: Dictionary): NavSection[] {
  return sections.map((section) => ({
    key: section.key,
    group: tOr(dict, `nav.group.${section.key}`, section.group),
    items: section.items.map((item) => ({
      href: item.href,
      label: tOr(dict, navKey(item.href), item.label),
    })),
  }));
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const companyShell = await companyShellFor(user).catch(
    (): CompanyShell => ({
      nav: COMPANY_NAV_FALLBACK,
      brand: 'Company',
      dir: 'ltr',
      locale: 'en',
      dict: getDictionary('en'),
      branding: DEFAULT_BRANDING,
    }),
  );

  const rawSections: NavSection[] = user.impersonation
    ? companyShell.nav
    : user.isSuperAdmin
      ? PLATFORM_NAV_GROUPS
      : user.role === ROLES.AGENT
      ? AGENT_NAV_GROUPS
      : companyShell.nav;

  // Super admins on the platform surfaces stay English/LTR; once they impersonate
  // they are looking at a company workspace, so they get that company's language
  // and direction too.
  const platformView = user.isSuperAdmin && !user.impersonation;
  const dict = platformView ? getDictionary('en') : companyShell.dict;
  const sections = translateSections(rawSections, dict);

  // The nav and the page can disagree, and it looks like a broken app.
  //
  // `/company` and `/super-admin` share this layout, and the App Router does not
  // re-render a shared layout when you navigate between routes inside it. So a
  // super admin whose impersonation ends — by expiry, most obviously — keeps the
  // company menu while the page beside it becomes the platform dashboard. The
  // sidebar is a client component that already knows the pathname, so it is
  // given both menus and picks the one that matches the route it is actually on.
  const platformSections = user.isSuperAdmin
    ? translateSections(PLATFORM_NAV_GROUPS, getDictionary('en'))
    : undefined;

  // The agency's product name replaces the platform's own on the platform-brand
  // surfaces only; a tenant workspace keeps showing the tenant's name.
  const brand = platformView ? 'Switch & Save' : companyShell.brand;
  const logoUrl = platformView ? null : companyShell.branding.logoUrl;

  const dir: ShellDir = platformView ? 'ltr' : companyShell.dir;
  // Rendered only for RTL: nothing above this element sets a direction, so an
  // explicit "ltr" would be a no-op and the English markup stays untouched.
  const shellDirAttr = dir === 'rtl' ? 'rtl' : undefined;
  // `lang` is only stated when it differs from the document's English default,
  // for the same reason.
  const shellLangAttr = platformView ? undefined : companyShell.locale === 'ar' ? 'ar' : undefined;

  const roleLabel = user.impersonation
    ? t(dict, 'shell.role.impersonating', {
        company: user.impersonation.companyName ?? 'company',
      })
    : user.isSuperAdmin
    ? t(dict, 'shell.role.super_admin')
    : user.role === ROLES.AGENT
      ? t(dict, 'shell.role.agent')
      : user.role === ROLES.COMPANY_ADMIN
        ? t(dict, 'shell.role.company_admin')
        : t(dict, 'shell.role.member');

  const shellLabels = {
    account: t(dict, 'shell.account'),
    viewingCustomer: t(dict, 'shell.viewing_customer'),
    openMenu: t(dict, 'shell.open_menu'),
    closeMenu: t(dict, 'shell.close_menu'),
    navMenu: t(dict, 'shell.nav_menu'),
    navMenuDescription: t(dict, 'shell.nav_menu_description'),
  };

  return (
    <div dir={shellDirAttr} lang={shellLangAttr} className="flex min-h-screen">
      <RefreshOnHistoryNav />
      <DesktopSidebar
        sections={sections}
        platformSections={platformSections}
        brand={brand}
        logoUrl={logoUrl}
        labels={shellLabels}
        impersonating={Boolean(user.impersonation)}
      />

      <div className="min-w-0 flex-1">
        {user.impersonation ? (
          <ImpersonationBanner
            companyName={user.impersonation.companyName ?? 'this customer account'}
            expiresAt={user.impersonation.expiresAt}
          >
            <EndImpersonationButton />
          </ImpersonationBanner>
        ) : null}
        {/* `bg-background` is stated rather than inherited from <body>: the
            header is the boundary between the sidebar gradient and the page,
            and in dark mode an unpainted strip there reads as a gap. */}
        <header className="flex h-14 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNav
              sections={sections}
              platformSections={platformSections}
              brand={brand}
              logoUrl={logoUrl}
              labels={shellLabels}
              impersonating={Boolean(user.impersonation)}
            />
            <span className="truncate text-sm text-muted-foreground">{roleLabel}</span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {/* Module 21 (RTL): an address is a Latin-script LTR token. Isolating it
                keeps the local part before the domain instead of letting the bidi
                algorithm reorder the run around the "@". No visual change under LTR.

                Shown on mobile too: while impersonating, this is the last signal of
                *whose* session is looking at the data, and hiding it below `sm`
                meant a phone screen gave no answer at all. It truncates rather
                than wraps, so it still costs one line. */}
            <span dir="ltr" className="max-w-[45vw] truncate text-sm sm:max-w-[40vw]">{user.email}</span>
            {/* Module 23. Next to sign-out because that is where a user looks
                for "settings about me rather than about the data". It is the
                only entry point to dark mode in the product: `enableSystem` is
                on, so before this existed a user with a dark OS got the dark
                token block and no way to leave it. */}
            <ThemeToggle />
            <SignOutButton label={t(dict, 'shell.sign_out')} />
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
