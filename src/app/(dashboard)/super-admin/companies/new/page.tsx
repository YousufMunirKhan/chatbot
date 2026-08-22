import { requireRole } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { CompanyForm } from '@/modules/super-admin/components/company-form';

export default async function NewCompanyPage() {
  // Defence in depth: the /super-admin layout already guards this subtree, but a
  // platform-operator surface should not rely on a single ancestor check.
  await requireRole([ROLES.SUPER_ADMIN]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        backTo={{ href: '/super-admin/companies', label: 'Back to companies' }}
        title="Onboard a company"
        description="Create the tenant, first company-admin login, subscription limits, and AI cost controls in one flow."
        actions={
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3 lg:w-[520px]">
            <div className="rounded-md border bg-card p-3">
              <p className="font-medium text-foreground">1. Tenant</p>
              <p className="mt-1 text-xs">Company and owner login.</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="font-medium text-foreground">2. Commercials</p>
              <p className="mt-1 text-xs">Plan, limits, and trial window.</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="font-medium text-foreground">3. AI risk</p>
              <p className="mt-1 text-xs">Budget cap, hard stop, cache.</p>
            </div>
          </div>
        }
      />

      <CompanyForm />
    </div>
  );
}
