import { requireUser, type SessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { SignOutButton } from '@/components/sign-out-button';
import { DesktopSidebar, ImpersonationBanner, MobileNav } from '@/components/dashboard-nav';
import { EndImpersonationButton } from '@/modules/super-admin/components/end-impersonation-button';
import { RefreshOnHistoryNav } from '@/components/refresh-on-history-nav';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { createSupabaseServiceClient } from '@/lib/db/server';

/**
 * Protected dashboard shell (Module 1 shell + Module 3 auth). Requires a signed-in
 * user and renders role-based navigation (Access Rules: super admin → platform,
 * company admin → full company, agent → conversation-focused subset).
 */
type NavSection = { group: string; items: { href: string; label: string }[] };

const PLATFORM_NAV: NavSection = {
  group: 'Platform',
  items: [
    { href: '/super-admin', label: 'Command Center' },
    { href: '/super-admin/companies', label: 'Companies' },
    { href: '/super-admin/billing', label: 'Billing & Plans' },
    { href: '/super-admin/quality', label: 'Quality & Usage' },
    // Reachable only by typed URL until now. /costs and /profit are the two
    // screens the platform's money questions are answered from, so an operator
    // having to know the URL was a real gap, not a cosmetic one.
    { href: '/super-admin/subscriptions', label: 'Subscriptions' },
    { href: '/super-admin/usage', label: 'Usage' },
    { href: '/super-admin/costs', label: 'AI Cost' },
    { href: '/super-admin/profit', label: 'Profit / Loss' },
    { href: '/super-admin/chat-logs', label: 'Chat Logs' },
    { href: '/super-admin/integrations', label: 'Integrations' },
    { href: '/super-admin/notifications', label: 'Notifications' },
    { href: '/super-admin/audit-logs', label: 'Audit Logs' },
    { href: '/super-admin/security', label: 'Security Logs' },
    { href: '/super-admin/error-logs', label: 'Error Logs' },
    { href: '/super-admin/settings', label: 'Settings' },
  ],
};

const COMPANY_ADMIN_NAV_ITEMS: NavSection['items'] = [
  { href: '/company', label: 'Home' },
  { href: '/company/setup', label: 'Setup' },
  { href: '/company/bots', label: 'Assistants' },
  { href: '/company/widget', label: 'Website Widget' },
  { href: '/company/inbox', label: 'Inbox' },
  { href: '/company/notifications', label: 'Notifications' },
  { href: '/company/customers', label: 'Customers' },
  { href: '/company/business-data', label: 'Business Data' },
  { href: '/company/quick-actions', label: 'Quick Actions' },
  { href: '/company/webhooks', label: 'Webhooks' },
  { href: '/company/settings', label: 'Team & Settings' },
];

const AGENT_NAV: NavSection = {
  group: 'Workspace',
  items: [
    { href: '/company/inbox', label: 'Inbox' },
    { href: '/company/customers', label: 'Customers' },
  ],
};

/**
 * Document direction for the dashboard shell (Module 21).
 *
 * The root `src/app/layout.tsx` cannot do this: it renders for the marketing,
 * auth and widget-embed routes too and has no session, so it has no company to
 * read `default_language` from. This layout already loads the company, so the
 * direction is set on the shell wrapper element instead — `dir` on a container
 * is valid HTML and inherits to every descendant exactly like `dir` on <html>.
 *
 * `lang` is deliberately NOT switched: the UI copy is still English (this change
 * is direction support, not translation), and lying about the language would
 * make screen readers pronounce English text with an Arabic voice.
 *
 * 'auto' and anything unrecognised stay LTR, so the un-configured and English
 * cases render exactly as before.
 */
type ShellDir = 'ltr' | 'rtl';

function shellDirFor(defaultLanguage: string | null | undefined): ShellDir {
  return defaultLanguage === 'ar' ? 'rtl' : 'ltr';
}

async function companyShellFor(user: SessionUser): Promise<{ nav: NavSection; brand: string; dir: ShellDir }> {
  if (!user.companyId)
    return { nav: { group: 'Company', items: COMPANY_ADMIN_NAV_ITEMS }, brand: 'Company', dir: 'ltr' };
  const sb = createSupabaseServiceClient();
  const [{ data: company }, { data: internalBot }, { data: connector }] = await Promise.all([
    sb.from('companies').select('name, default_language').eq('id', user.companyId).maybeSingle(),
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
  ]);

  const showInternalHelpDesk = Boolean(internalBot || connector);
  const items = showInternalHelpDesk
    ? [
        ...COMPANY_ADMIN_NAV_ITEMS.slice(0, 4),
        { href: '/company/help-desk', label: 'Internal Help Desk' },
        ...COMPANY_ADMIN_NAV_ITEMS.slice(4),
      ]
    : COMPANY_ADMIN_NAV_ITEMS;
  return {
    nav: { group: 'Company', items },
    brand: company?.name ?? 'Company',
    dir: shellDirFor(company?.default_language as string | null | undefined),
  };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const companyShell = await companyShellFor(user).catch(() => ({
    nav: { group: 'Company', items: COMPANY_ADMIN_NAV_ITEMS },
    brand: 'Company',
    dir: 'ltr' as ShellDir,
  }));

  const sections: NavSection[] = user.impersonation
    ? [companyShell.nav]
    : user.isSuperAdmin
      ? [PLATFORM_NAV]
      : user.role === ROLES.AGENT
      ? [AGENT_NAV]
      : [companyShell.nav];

  const brand = user.isSuperAdmin && !user.impersonation ? 'Switch & Save' : companyShell.brand;

  // Super admins on the platform surfaces stay LTR; once they impersonate they are
  // looking at a company workspace, so they get that company's direction too.
  const dir: ShellDir = user.isSuperAdmin && !user.impersonation ? 'ltr' : companyShell.dir;
  // Rendered only for RTL: nothing above this element sets a direction, so an
  // explicit "ltr" would be a no-op and the English markup stays untouched.
  const shellDirAttr = dir === 'rtl' ? 'rtl' : undefined;

  const roleLabel = user.impersonation
    ? `Impersonating ${user.impersonation.companyName ?? 'company'}`
    : user.isSuperAdmin
    ? 'Super Admin'
    : user.role === ROLES.AGENT
      ? 'Agent'
      : user.role === ROLES.COMPANY_ADMIN
        ? 'Company Admin'
        : 'Member';

  return (
    <div dir={shellDirAttr} className="flex min-h-screen">
      <RefreshOnHistoryNav />
      <DesktopSidebar sections={sections} brand={brand} impersonating={Boolean(user.impersonation)} />

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
            <MobileNav sections={sections} brand={brand} impersonating={Boolean(user.impersonation)} />
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
            <SignOutButton />
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
