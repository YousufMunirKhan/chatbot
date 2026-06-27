import { requireUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import { DesktopSidebar, MobileNav } from '@/components/dashboard-nav';
import { endImpersonationAction } from '@/modules/super-admin/impersonation-actions';

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
    { href: '/super-admin/settings', label: 'Settings' },
  ],
};

const COMPANY_ADMIN_NAV: NavSection = {
  group: 'Company',
  items: [
    { href: '/company', label: 'Home' },
    { href: '/company/setup', label: 'Setup' },
    { href: '/company/inbox', label: 'Inbox' },
    { href: '/company/help-desk', label: 'Help Desk' },
    { href: '/company/customers', label: 'Customers' },
    { href: '/company/business-data', label: 'Business Data' },
    { href: '/company/webhooks', label: 'Webhooks' },
    { href: '/company/settings', label: 'Team & Settings' },
  ],
};

const AGENT_NAV: NavSection = {
  group: 'Workspace',
  items: [
    { href: '/company/inbox', label: 'Inbox' },
    { href: '/company/customers', label: 'Customers' },
  ],
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const sections: NavSection[] = user.impersonation
    ? [COMPANY_ADMIN_NAV]
    : user.isSuperAdmin
      ? [PLATFORM_NAV]
      : user.role === ROLES.AGENT
      ? [AGENT_NAV]
      : [COMPANY_ADMIN_NAV];

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
    <div className="flex min-h-screen">
      <DesktopSidebar sections={sections} brand="Switch & Save" />

      <div className="min-w-0 flex-1">
        {user.impersonation ? (
          <div className="flex flex-col items-start justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
            <span>
              Super Admin impersonation is active for {user.impersonation.companyName ?? 'this company'} until{' '}
              {new Date(user.impersonation.expiresAt).toLocaleTimeString()}.
            </span>
            <form action={endImpersonationAction}>
              <Button type="submit" variant="outline" size="sm">End impersonation</Button>
            </form>
          </div>
        ) : null}
        <header className="flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNav sections={sections} brand="Switch & Save" />
            <span className="truncate text-sm text-muted-foreground">{roleLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[40vw] truncate text-sm sm:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
