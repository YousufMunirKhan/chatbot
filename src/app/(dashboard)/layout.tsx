import { requireUser, type SessionUser } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import { DesktopSidebar, MobileNav } from '@/components/dashboard-nav';
import { endImpersonationAction } from '@/modules/super-admin/impersonation-actions';
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
    { href: '/super-admin/settings', label: 'Settings' },
  ],
};

const COMPANY_ADMIN_NAV_ITEMS: NavSection['items'] = [
  { href: '/company', label: 'Home' },
  { href: '/company/setup', label: 'Setup' },
  { href: '/company/widget', label: 'Website Widget' },
  { href: '/company/inbox', label: 'Inbox' },
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

async function companyShellFor(user: SessionUser): Promise<{ nav: NavSection; brand: string }> {
  if (!user.companyId) return { nav: { group: 'Company', items: COMPANY_ADMIN_NAV_ITEMS }, brand: 'Company' };
  const sb = createSupabaseServiceClient();
  const [{ data: company }, { data: internalBot }, { data: connector }] = await Promise.all([
    sb.from('companies').select('name').eq('id', user.companyId).maybeSingle(),
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
  return { nav: { group: 'Company', items }, brand: company?.name ?? 'Company' };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const companyShell = await companyShellFor(user).catch(() => ({
    nav: { group: 'Company', items: COMPANY_ADMIN_NAV_ITEMS },
    brand: 'Company',
  }));

  const sections: NavSection[] = user.impersonation
    ? [companyShell.nav]
    : user.isSuperAdmin
      ? [PLATFORM_NAV]
      : user.role === ROLES.AGENT
      ? [AGENT_NAV]
      : [companyShell.nav];

  const brand = user.isSuperAdmin && !user.impersonation ? 'Switch & Save' : companyShell.brand;

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
      <DesktopSidebar sections={sections} brand={brand} />

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
            <MobileNav sections={sections} brand={brand} />
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
